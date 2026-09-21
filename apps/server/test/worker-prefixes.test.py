"""Exercise real worker control flow with an in-memory SMB client, without NAS access."""
import ast
from pathlib import Path
import re
import unittest

source = Path(__file__).parents[1] / 'smb' / 'worker.py'
tree = ast.parse(source.read_text())
selected = [node for node in tree.body if
            isinstance(node, ast.FunctionDef) and node.name in ('is_temporary_name', 'is_note_temporary_name', 'is_reserved_name', 'path_parts', 'run')
            or isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('TEMP_PREFIX', 'NOTE_TEMP_PREFIX') for t in node.targets)]
namespace = {'re': re}
exec(compile(ast.Module(body=selected, type_ignores=[]), str(source), 'exec'), namespace)


class Handle:
    def close(self):
        pass


class Client:
    changes = []

    def __init__(self, config):
        pass

    def open(self, *args, **kwargs):
        return Handle()

    def parents(self, path):
        pass

    def identity(self, handle):
        return 'registered-object'

    def set_info(self, handle, info):
        self.changes.append(info)

    def close(self):
        pass


namespace.update(Client=Client, FileDispositionInformation=dict, emit=lambda **event: None)


class PrefixTests(unittest.TestCase):
    def test_cleanup_requires_matching_object_and_reserved_name(self):
        for prefix in ('.cove-upload-', '.COVE-UPLOAD-', '.cove-note-', '.COVE-NOTE-'):
            Client.changes.clear()
            namespace['run']({'action': 'cleanup', 'path': prefix + 'x.part', 'objectId': 'registered-object'})
            self.assertEqual(Client.changes, [{'delete_pending': True}])
            Client.changes.clear()
            with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
                namespace['run']({'action': 'cleanup', 'path': prefix + 'x.part', 'objectId': 'different'})
            self.assertEqual(Client.changes, [])
        with self.assertRaisesRegex(ValueError, 'OBJECT_CHANGED'):
            namespace['run']({'action': 'cleanup', 'path': 'ordinary.txt', 'objectId': 'registered-object'})

    def test_user_actions_cannot_modify_reserved_prefix(self):
        for prefix in ('.cove-upload-', '.COVE-UPLOAD-', '.cove-note-', '.COVE-NOTE-'):
            for action in ('delete', 'rename'):
                with self.assertRaisesRegex(ValueError, 'INVALID_PATH'):
                    namespace['run']({'action': action, 'path': prefix + 'x.part', 'targetPath': 'ordinary.txt'})
            with self.assertRaisesRegex(ValueError, 'INVALID_PATH'):
                namespace['run']({'action': 'rename', 'path': 'ordinary.txt', 'targetPath': prefix + 'x.part'})

    def test_write_note_rejects_foreign_temp_paths(self):
        cases = [
            {'action': 'write_note', 'path': 'Markdown Notes/a.md',
             'tempPath': 'Markdown Notes/.cove-upload-x.part', 'expected': {}, 'size': '0'},
            {'action': 'write_note', 'path': 'Markdown Notes/a.md',
             'tempPath': 'Markdown Notes/b.md', 'expected': {}, 'size': '0'},
            {'action': 'write_note', 'path': 'Markdown Notes/a.md',
             'tempPath': 'Other/.cove-note-x.part', 'expected': {}, 'size': '0'},
            {'action': 'write_note', 'path': 'Markdown Notes/a.md',
             'tempPath': 'Markdown Notes/.cove-note-x.part', 'expected': None, 'size': '0'},
        ]
        for case in cases:
            with self.assertRaisesRegex(ValueError, 'INVALID_PATH'):
                namespace['run'](case)


if __name__ == '__main__':
    unittest.main()
