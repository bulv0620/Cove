"""Full notes write path through the real worker module against an in-memory SMB server.

Unlike the AST-extracted prefix test, this imports worker.py with stubbed
smbprotocol modules and executes run() end to end: pinning, sharing
violations, the conditional swap, identity checks, and backup cleanup all run
for real, so a TypeError inside the control flow (or a silent-overwrite race)
fails loudly here.
"""
import datetime
import importlib.util
import io
import json
import sys
import types
import unittest
import uuid
from pathlib import Path

STATUS_NOT_FOUND = 0xC0000034
STATUS_COLLISION = 0xC0000035
STATUS_SHARING = 0xC0000043
STATUS_ACCESS_DENIED = 0xC0000022
ACCESS_READ, ACCESS_WRITE, ACCESS_DELETE = 0x1, 0x2, 0x10000
FILE_DIRECTORY_FILE = 0x1
FILE_NON_DIRECTORY_FILE = 0x40
FILE_OPEN = 0x1
FILE_CREATE = 0x2
FILE_OPEN_REPARSE_POINT = 0x200000
MTIME = datetime.datetime(2026, 9, 21, 10, 0, 0, 123_000, tzinfo=datetime.timezone.utc)


class FakeSmbError(Exception):
    def __init__(self, status):
        super().__init__(hex(status))
        self.status = status


class Info:
    """FileRenameInformation / FileDispositionInformation stand-in."""

    def __init__(self, **defaults):
        self._d = dict(defaults)

    def __setitem__(self, key, value):
        self._d[key] = value

    def __getitem__(self, key):
        return self._d[key]

    def pack(self):  # pragma: no cover - the protocol path must never run
        raise AssertionError('encoded set_info reached the wire')


class FakeObject:
    counter = iter(range(1, 1_000_000))

    def __init__(self, data, mtime):
        self.data = bytearray(data)
        self.mtime = mtime
        self.identity = next(FakeObject.counter)


class FakeOpen:
    """Signature matches worker usage: Open(tree, '\\'-joined path)."""

    def __init__(self, tree, path):
        self.fs = STATE
        self.path = path.replace('\\', '/')
        self.object = None
        self.access = 0
        self.share = 0
        self.delete_pending = False
        self.file_attributes = 0

    def create(self, _impersonation, access, _attrs, share, disposition, options):
        fs = self.fs
        is_dir = self.path in fs.dirs or self.path == ''
        exists = is_dir or self.path in fs.files
        if disposition == FILE_CREATE:
            if exists:
                raise FakeSmbError(STATUS_COLLISION)
            if options & FILE_DIRECTORY_FILE:
                fs.dirs.add(self.path)
                obj = None
            else:
                obj = FakeObject(b'', MTIME)
                fs.files[self.path] = obj
        elif not exists:
            raise FakeSmbError(STATUS_NOT_FOUND)
        else:
            if options & FILE_DIRECTORY_FILE and not is_dir:
                raise FakeSmbError(STATUS_NOT_FOUND)
            if options & FILE_NON_DIRECTORY_FILE and is_dir:
                raise FakeSmbError(STATUS_NOT_FOUND)
            obj = None if is_dir else fs.files[self.path]
        for other in fs.opens:
            if other.object is None or other.object is not obj:
                continue
            if (
                (access & ACCESS_READ and not other.share & 1)
                or (access & ACCESS_WRITE and not other.share & 2)
                or (access & ACCESS_DELETE and not other.share & 4)
                or (other.access & ACCESS_READ and not share & 1)
                or (other.access & ACCESS_WRITE and not share & 2)
                or (other.access & ACCESS_DELETE and not share & 4)
            ):
                raise FakeSmbError(STATUS_SHARING)
        self.object = obj
        self.access = access
        self.share = share
        self.file_attributes = 0x10 if is_dir else 0x80
        fs.opens.append(self)

    @property
    def end_of_file(self):
        return len(self.object.data)

    @property
    def last_write_time(self):
        return self.object.mtime

    def write(self, data, offset):
        self.object.data[offset : offset + len(data)] = data
        return len(data)

    def read(self, offset, length):
        return bytes(self.object.data[offset : offset + length])

    def flush(self):
        pass

    def close(self):
        if self in self.fs.opens:
            self.fs.opens.remove(self)
        if self.delete_pending and self.object is not None:
            path = self.fs.path_of(self.object)
            if path:
                del self.fs.files[path]


class FS:
    def __init__(self):
        self.files = {}
        self.dirs = set()
        self.opens = []
        self.hooks = {}

    def add_dir(self, path):
        self.dirs.add(path)

    def add_file(self, path, data, mtime=MTIME):
        self.files[path] = FakeObject(data, mtime)

    def path_of(self, obj):
        for path, candidate in self.files.items():
            if candidate is obj:
                return path
        return None

    def rename(self, handle, info):
        if not handle.access & ACCESS_DELETE:
            raise FakeSmbError(STATUS_ACCESS_DENIED)
        target = info['file_name'].replace('\\', '/')
        if target in self.dirs or target in self.files:
            if not info['replace_if_exists']:
                raise FakeSmbError(STATUS_COLLISION)
            replaced = self.files[target]
            for other in self.opens:
                if other.object is replaced and other is not handle and not other.share & 4:
                    raise FakeSmbError(STATUS_SHARING)
            del self.files[target]
        del self.files[handle.path]
        self.files[target] = handle.object
        hook = self.hooks.get('after_rename')
        if hook:
            hook(handle.path, target)
        handle.path = target


STATE = FS()


class Capture:
    def __init__(self):
        self.lines = []

    def write(self, text):
        self.lines.append(text)

    def flush(self):
        pass


def load_worker():
    smb = types.ModuleType('smbprotocol')
    for name in ('connection', 'session', 'tree', 'open', 'file_info', 'structure'):
        sub = types.ModuleType(f'smbprotocol.{name}')
        sys.modules[f'smbprotocol.{name}'] = sub
        setattr(smb, name, sub)
    sys.modules['smbprotocol'] = smb
    smb.connection.Connection = object
    smb.connection.Dialects = types.SimpleNamespace(SMB_2_1_0=0x210)
    smb.session.Session = object
    smb.tree.TreeConnect = object
    smb.open.Open = FakeOpen
    smb.open.CreateOptions = types.SimpleNamespace(
        FILE_OPEN_REPARSE_POINT=FILE_OPEN_REPARSE_POINT,
        FILE_DIRECTORY_FILE=FILE_DIRECTORY_FILE,
        FILE_NON_DIRECTORY_FILE=FILE_NON_DIRECTORY_FILE,
    )
    smb.open.CreateDisposition = types.SimpleNamespace(FILE_CREATE=FILE_CREATE, FILE_OPEN=FILE_OPEN)
    smb.open.FileAttributes = types.SimpleNamespace(
        FILE_ATTRIBUTE_NORMAL=0x80, FILE_ATTRIBUTE_REPARSE_POINT=0x400
    )
    smb.open.ImpersonationLevel = types.SimpleNamespace(Impersonation=2)
    for name in ('SMB2QueryInfoRequest', 'SMB2QueryInfoResponse', 'SMB2SetInfoRequest'):
        setattr(smb.open, name, object)
    smb.file_info.FileInformationClass = object
    smb.file_info.FileInternalInformation = object
    smb.file_info.FileAllInformation = object
    smb.file_info.FileRenameInformation = lambda: Info(replace_if_exists=False, file_name='')
    smb.file_info.FileDispositionInformation = lambda: Info(delete_pending=False)
    smb.structure.DateTimeField = object
    spec = importlib.util.spec_from_file_location(
        'worker_under_test', Path(__file__).parents[1] / 'smb' / 'worker.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


worker = load_worker()


class FakeClient(worker.Client):
    """Real open()/parents() control flow; protocol plumbing reads the fake FS."""

    def __init__(self, config):
        self.handles = []
        self.fs = STATE
        self.tree = None
        self.connection = types.SimpleNamespace(max_read_size=1 << 20, max_write_size=1 << 20)

    def identity(self, handle):
        return str(handle.object.identity)

    def stat_info(self, handle):
        return (
            str(handle.object.identity),
            str(len(handle.object.data)),
            worker.iso_ms(handle.object.mtime),
        )

    def set_info(self, handle, info):
        if 'replace_if_exists' in info._d:
            self.fs.rename(handle, info)
        elif info['delete_pending']:
            handle.delete_pending = True

    def close(self):
        # Disconnecting closes every handle; delete-on-close takes effect then.
        for handle in list(self.fs.opens):
            handle.close()


worker.Client = FakeClient


def run_worker(config, body=b''):
    events = Capture()
    real_sys, real_os = worker.sys, worker.os
    worker.sys = types.SimpleNamespace(
        stdin=types.SimpleNamespace(buffer=io.BytesIO(body)),
        stderr=events,
        stdout=io.BytesIO(),
    )
    worker.os = types.SimpleNamespace(fdopen=lambda fd, mode: io.StringIO('commit\n'))
    try:
        worker.run(config)
    finally:
        worker.sys, worker.os = real_sys, real_os
    return [json.loads(line) for line in events.lines]


def note_paths(name='a.md'):
    return {
        'path': f'Markdown Notes/{name}',
        'tempPath': f'Markdown Notes/.cove-note-{uuid.uuid4()}.part',
        'backupPath': f'Markdown Notes/.cove-note-{uuid.uuid4()}.prev.part',
    }


class WorkerNotesTests(unittest.TestCase):
    def setUp(self):
        STATE.files.clear()
        STATE.dirs.clear()
        STATE.opens.clear()
        STATE.hooks.clear()
        STATE.add_dir('Markdown Notes')

    def test_write_note_replaces_an_existing_note_and_releases_the_backup(self):
        # Regression: the post-commit re-check used to call the zero-argument
        # `unchanged` with `target`, so every existing-note save died on a TypeError.
        paths = note_paths()
        STATE.add_file(paths['path'], b'# old\n')
        expected = {
            'objectId': str(STATE.files[paths['path']].identity),
            'sizeBytes': '6',
            'modifiedAt': worker.iso_ms(MTIME),
        }
        body = b'# replaced\n'
        events = run_worker(
            {
                'action': 'write_note',
                'size': str(len(body)),
                'expected': expected,
                **paths,
            },
            body,
        )
        result = events[-1]['result']
        self.assertEqual(result['bytes'], str(len(body)))
        self.assertEqual(result['sizeBytes'], str(len(body)))
        self.assertFalse(result['residual'])
        self.assertEqual(bytes(STATE.files[paths['path']].data), body)
        self.assertNotIn(paths['tempPath'], STATE.files)
        self.assertNotIn(paths['backupPath'], STATE.files)
        identities = {obj.identity for obj in STATE.files.values()}
        self.assertNotIn(int(expected['objectId']), identities)

    def test_write_note_rechecks_the_target_after_the_commit_gate(self):
        paths = note_paths()
        STATE.add_file(paths['path'], b'# old\n')
        target = STATE.files[paths['path']]
        expected = {
            'objectId': str(target.identity),
            'sizeBytes': '6',
            'modifiedAt': worker.iso_ms(MTIME),
        }
        real_write = FakeOpen.write

        def spying_write(self, data, offset):
            # An external writer slips in after staging; the pin should have made
            # this impossible, but the re-check must still refuse the swap.
            result = real_write(self, data, offset)
            target.mtime = datetime.datetime(2026, 9, 21, 11, 0, 0, tzinfo=datetime.timezone.utc)
            return result

        FakeOpen.write = spying_write
        try:
            with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
                run_worker(
                    {
                        'action': 'write_note',
                        'size': '9',
                        'expected': expected,
                        **paths,
                    },
                    b'# newbody',
                )
        finally:
            FakeOpen.write = real_write
        self.assertEqual(bytes(STATE.files[paths['path']].data), b'# old\n')
        self.assertEqual(
            STATE.files[paths['path']].mtime,
            datetime.datetime(2026, 9, 21, 11, 0, 0, tzinfo=datetime.timezone.utc),
        )
        self.assertIn(paths['tempPath'], STATE.files)

    def test_a_name_taken_during_the_swap_never_overwrites_and_keeps_the_original(self):
        paths = note_paths()
        STATE.add_file(paths['path'], b'# original\n')
        target = STATE.files[paths['path']]
        expected = {
            'objectId': str(target.identity),
            'sizeBytes': '11',
            'modifiedAt': worker.iso_ms(MTIME),
        }

        def race_in_after_rename_away(source, destination):
            if destination == paths['backupPath']:
                STATE.add_file(paths['path'], b'# squatter\n')

        STATE.hooks['after_rename'] = race_in_after_rename_away
        with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
            run_worker(
                {
                    'action': 'write_note',
                    'size': '10',
                    'expected': expected,
                    **paths,
                },
                b'# newstuff',
            )
        # The squatter keeps the name; the original survives in the registered
        # backup so recovery can restore or surface it - never a silent overwrite.
        self.assertEqual(bytes(STATE.files[paths['path']].data), b'# squatter\n')
        self.assertEqual(bytes(STATE.files[paths['backupPath']].data), b'# original\n')

    def test_write_note_maps_a_missing_target_to_object_changed(self):
        paths = note_paths()
        with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
            run_worker(
                {
                    'action': 'write_note',
                    'size': '0',
                    'expected': {'objectId': '1', 'sizeBytes': '0', 'modifiedAt': 'x'},
                    **paths,
                },
                b'',
            )

    def test_a_conflicting_external_reader_blocks_the_pin_with_file_busy(self):
        paths = note_paths()
        STATE.add_file(paths['path'], b'# old\n')
        blocker = FakeOpen(None, paths['path'])
        blocker.create(None, ACCESS_READ, 0x80, 0x3, FILE_OPEN, FILE_OPEN_REPARSE_POINT)
        with self.assertRaises(FakeSmbError) as caught:
            run_worker(
                {
                    'action': 'write_note',
                    'size': '0',
                    'expected': {
                        'objectId': str(STATE.files[paths['path']].identity),
                        'sizeBytes': '6',
                        'modifiedAt': worker.iso_ms(MTIME),
                    },
                    **paths,
                },
                b'',
            )
        self.assertEqual(caught.exception.status, STATUS_SHARING)

    def test_rename_verifies_object_identity_when_one_is_presented(self):
        STATE.add_file('Markdown Notes/a.md', b'# a\n')
        STATE.add_file('Markdown Notes/b.md', b'# b\n')
        real_identity = str(STATE.files['Markdown Notes/a.md'].identity)
        run_worker(
            {
                'action': 'rename',
                'path': 'Markdown Notes/a.md',
                'targetPath': 'Markdown Notes/c.md',
                'objectId': real_identity,
            }
        )
        self.assertIn('Markdown Notes/c.md', STATE.files)
        with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
            run_worker(
                {
                    'action': 'rename',
                    'path': 'Markdown Notes/b.md',
                    'targetPath': 'Markdown Notes/d.md',
                    'objectId': 'not-the-object',
                }
            )
        self.assertIn('Markdown Notes/b.md', STATE.files)

    def test_delete_object_refuses_a_replaced_target(self):
        STATE.add_file('Markdown Notes/a.md', b'# a\n')
        with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
            run_worker(
                {
                    'action': 'delete_object',
                    'path': 'Markdown Notes/a.md',
                    'objectId': 'not-the-object',
                }
            )
        self.assertIn('Markdown Notes/a.md', STATE.files)
        run_worker(
            {
                'action': 'delete_object',
                'path': 'Markdown Notes/a.md',
                'objectId': str(STATE.files['Markdown Notes/a.md'].identity),
            }
        )
        self.assertNotIn('Markdown Notes/a.md', STATE.files)

    def test_restore_moves_a_registered_backup_back_to_a_vacant_path(self):
        backup = f'Markdown Notes/.cove-note-{uuid.uuid4()}.prev.part'
        STATE.add_file(backup, b'# original\n')
        identity = str(STATE.files[backup].identity)
        events = run_worker(
            {
                'action': 'restore',
                'path': backup,
                'targetPath': 'Markdown Notes/a.md',
                'objectId': identity,
            }
        )
        self.assertEqual(events[-1]['result']['relativePath'], 'Markdown Notes/a.md')
        self.assertEqual(bytes(STATE.files['Markdown Notes/a.md'].data), b'# original\n')
        self.assertNotIn(backup, STATE.files)

    def test_restore_refuses_mismatches_and_occupied_paths(self):
        backup = f'Markdown Notes/.cove-note-{uuid.uuid4()}.prev.part'
        STATE.add_file(backup, b'# original\n')
        STATE.add_file('Markdown Notes/a.md', b'# squatter\n')
        with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
            run_worker(
                {
                    'action': 'restore',
                    'path': backup,
                    'targetPath': 'Markdown Notes/a.md',
                    'objectId': 'not-the-object',
                }
            )
        with self.assertRaises(FakeSmbError) as caught:
            run_worker(
                {
                    'action': 'restore',
                    'path': backup,
                    'targetPath': 'Markdown Notes/a.md',
                    'objectId': str(STATE.files[backup].identity),
                }
            )
        self.assertEqual(caught.exception.status, STATUS_COLLISION)
        self.assertEqual(bytes(STATE.files['Markdown Notes/a.md'].data), b'# squatter\n')
        self.assertEqual(bytes(STATE.files[backup].data), b'# original\n')

    def test_note_creation_lands_once_and_a_duplicate_collides(self):
        path = 'Markdown Notes/验收-20260921-代码审查.md'
        run_worker(
            {
                'action': 'write',
                'path': path,
                'tempPath': f'Markdown Notes/.cove-note-{uuid.uuid4()}.part',
                'noteTemp': True,
                'size': '0',
            }
        )
        self.assertIn(path, STATE.files)
        self.assertEqual(len(STATE.files[path].data), 0)
        with self.assertRaises(FakeSmbError) as caught:
            run_worker(
                {
                    'action': 'write',
                    'path': path,
                    'tempPath': f'Markdown Notes/.cove-note-{uuid.uuid4()}.part',
                    'noteTemp': True,
                    'size': '0',
                }
            )
        self.assertEqual(caught.exception.status, STATUS_COLLISION)


if __name__ == '__main__':
    unittest.main()
