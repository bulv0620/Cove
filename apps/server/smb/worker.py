"""One isolated SMB session per operation. JSON control over pipes; bytes never staged locally."""
import datetime
import hashlib
import io
import json
import logging
import os
import re
import sys
import uuid
import warnings

from smbprotocol.connection import Connection, Dialects
from smbprotocol.session import Session
from smbprotocol.tree import TreeConnect
from smbprotocol.open import (
    Open, CreateOptions, CreateDisposition, FileAttributes, ImpersonationLevel,
    SMB2QueryInfoRequest, SMB2QueryInfoResponse, SMB2SetInfoRequest,
)
from smbprotocol.file_info import (
    FileInformationClass, FileInternalInformation, FileRenameInformation, FileDispositionInformation,
    FileAllInformation,
)
from smbprotocol.structure import DateTimeField

logging.disable(logging.CRITICAL)


TEMP_PREFIX = '.cove-upload-'
NOTE_TEMP_PREFIX = '.cove-note-'
IMAGE_FORMATS = {
    'JPEG': ('image/jpeg', 'jpg'), 'PNG': ('image/png', 'png'),
    'WEBP': ('image/webp', 'webp'), 'GIF': ('image/gif', 'gif'),
    'AVIF': ('image/avif', 'avif'),
}


class ImageContainerBoundary:
    """Streaming container-end checks reject bytes hidden after a valid raster image."""
    def __init__(self):
        self.total = 0
        self.head = bytearray()
        self.tail = bytearray()
        self.avif_header = bytearray()
        self.avif_remaining = 0
        self.avif_boxes = 0
        self.avif_first_type = None
        self.avif_valid = True

    def feed(self, data):
        self.total += len(data)
        if len(self.head) < 16:
            self.head.extend(data[:16 - len(self.head)])
        self.tail.extend(data)
        if len(self.tail) > 16:
            del self.tail[:-16]
        offset = 0
        while offset < len(data) and self.avif_valid:
            if self.avif_remaining:
                consumed = min(self.avif_remaining, len(data) - offset)
                self.avif_remaining -= consumed
                offset += consumed
                continue
            needed = 8
            if len(self.avif_header) >= 8 and int.from_bytes(self.avif_header[:4], 'big') == 1:
                needed = 16
            consumed = min(needed - len(self.avif_header), len(data) - offset)
            self.avif_header.extend(data[offset:offset + consumed])
            offset += consumed
            if len(self.avif_header) < needed:
                continue
            size = int.from_bytes(self.avif_header[:4], 'big')
            box_type = bytes(self.avif_header[4:8])
            header_size = needed
            if size == 1:
                size = int.from_bytes(self.avif_header[8:16], 'big')
            if size == 0 or size < header_size:
                self.avif_valid = False
                break
            if self.avif_boxes == 0:
                self.avif_first_type = box_type
            self.avif_boxes += 1
            self.avif_remaining = size - header_size
            self.avif_header.clear()

    def validate(self, image_format):
        valid = {
            'JPEG': bytes(self.tail).endswith(b'\xff\xd9'),
            'PNG': len(self.tail) >= 12 and bytes(self.tail[-12:-8]) == b'\x00\x00\x00\x00'
                   and bytes(self.tail[-8:-4]) == b'IEND',
            'GIF': bytes(self.tail).endswith(b';'),
            'WEBP': len(self.head) >= 12 and bytes(self.head[:4]) == b'RIFF'
                    and bytes(self.head[8:12]) == b'WEBP'
                    and int.from_bytes(self.head[4:8], 'little') + 8 == self.total,
            'AVIF': self.avif_valid and self.avif_first_type == b'ftyp'
                    and self.avif_boxes >= 2 and self.avif_remaining == 0
                    and not self.avif_header,
        }.get(image_format, False)
        if not valid:
            raise ValueError('INVALID_IMAGE')


def load_image_support():
    from PIL import Image, ImageFile
    try:
        import pillow_avif  # noqa: F401
    except ImportError:
        pass
    Image.MAX_IMAGE_PIXELS = 25_000_000
    warnings.simplefilter('error', Image.DecompressionBombWarning)
    return Image, ImageFile


def validate_image_bytes(raw, expected_extension=None):
    Image, _ = load_image_support()
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.verify()
            media = IMAGE_FORMATS.get(image.format)
            image_format = image.format
        if not media:
            raise ValueError('UNSUPPORTED_IMAGE')
        if expected_extension and expected_extension != media[1]:
            if not (expected_extension == 'jpeg' and media[1] == 'jpg'):
                raise ValueError('INVALID_IMAGE')
        boundary = ImageContainerBoundary()
        boundary.feed(raw)
        boundary.validate(image_format)
        return media
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('INVALID_IMAGE') from exc


def is_temporary_name(name):
    return name.lower().startswith(TEMP_PREFIX)


def is_note_temporary_name(name):
    return name.lower().startswith(NOTE_TEMP_PREFIX)


def is_reserved_name(name):
    return is_temporary_name(name) or is_note_temporary_name(name)


def emit(**event):
    sys.stderr.write(json.dumps(event, ensure_ascii=True) + '\n')
    sys.stderr.flush()


def iso_ms(value):
    """Millisecond-precision ISO timestamps keep revision round-trips byte-stable."""
    return value.replace(microsecond=value.microsecond // 1000 * 1000).isoformat()


def path_parts(path):
    if not isinstance(path, str) or len(path.encode('utf-16-le')) > 4096:
        raise ValueError('INVALID_PATH')
    parts = path.split('/') if path else []
    for part in parts:
        if (not part or part in ('.', '..') or part[-1:] in ('.', ' ')
                or re.search(r'[\\:"<>|?*\x00-\x1f\x7f]', part)
                or len(part.encode('utf-16-le')) > 510):
            raise ValueError('INVALID_PATH')
    return parts


class Client:
    def __init__(self, config):
        self.handles = []
        self.connection = Connection(uuid.uuid4(), config['host'], config['port'], require_signing=True)
        self.connection.connect(timeout=config['connectTimeout'] / 1000)
        if self.connection.dialect < Dialects.SMB_2_1_0:
            raise ValueError('SMB_SECURITY_REQUIRED')
        username = config['username']
        if config.get('domain'):
            username = config['domain'] + '\\' + username
        if config['encrypt'] and not self.connection.supports_encryption:
            raise ValueError('SMB_SECURITY_REQUIRED')
        self.session = Session(self.connection, username=username, password=config['password'],
                               require_encryption=config['encrypt'], auth_protocol='ntlm')
        self.session.connect()
        self.tree = TreeConnect(self.session, '\\\\' + config['host'] + '\\' + config['share'])
        self.tree.connect()
        if self.tree.is_dfs_share:
            raise ValueError('UNSUPPORTED_LINK')

    def open(self, path, directory=None, create=False, write=False, delete=False, share=0x3):
        handle = Open(self.tree, '\\'.join(path_parts(path)))
        options = CreateOptions.FILE_OPEN_REPARSE_POINT
        if directory is not None:
            options |= CreateOptions.FILE_DIRECTORY_FILE if directory else CreateOptions.FILE_NON_DIRECTORY_FILE
        # READ_ATTRIBUTES | SYNCHRONIZE | READ_DATA; writers add WRITE_DATA and DELETE.
        access = 0x100081 | (0x2 if write else 0) | (0x10000 if delete else 0)
        handle.create(ImpersonationLevel.Impersonation, access, FileAttributes.FILE_ATTRIBUTE_NORMAL,
                      share, CreateDisposition.FILE_CREATE if create else CreateDisposition.FILE_OPEN, options)
        self.handles.append(handle)
        if handle.file_attributes & FileAttributes.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError('UNSUPPORTED_LINK')
        return handle

    def parents(self, path):
        parts = path_parts(path)
        # Keep ancestors open without FILE_SHARE_DELETE until this operation ends.
        for i in range(len(parts)):
            self.open('/'.join(parts[:i]), directory=True)

    def identity(self, handle):
        req = SMB2QueryInfoRequest()
        req['info_type'] = FileInternalInformation.INFO_TYPE
        req['file_info_class'] = FileInternalInformation.INFO_CLASS
        req['output_buffer_length'] = 8
        req['file_id'] = handle.file_id
        pending = self.connection.send(req, self.session.session_id, self.tree.tree_connect_id)
        response = SMB2QueryInfoResponse()
        response.unpack(self.connection.receive(pending)['data'].get_value())
        return str(response.parse_buffer(FileInternalInformation)['index_number'].get_value())

    def stat_info(self, handle):
        """Fresh identity, size, and mtime beyond the values cached at open."""
        req = SMB2QueryInfoRequest()
        req['info_type'] = FileAllInformation.INFO_TYPE
        req['file_info_class'] = FileAllInformation.INFO_CLASS
        req['output_buffer_length'] = 1024
        req['file_id'] = handle.file_id
        pending = self.connection.send(req, self.session.session_id, self.tree.tree_connect_id)
        response = SMB2QueryInfoResponse()
        response.unpack(self.connection.receive(pending)['data'].get_value())
        info = response.parse_buffer(FileAllInformation)
        stamp = DateTimeField()
        stamp.set_value(int(info['basic_information']['last_write_time'].get_value()).to_bytes(8, 'little'))
        return (str(info['internal_information']['index_number'].get_value()),
                str(info['standard_information']['end_of_file'].get_value()),
                iso_ms(stamp.get_value()))

    def set_info(self, handle, info):
        req = SMB2SetInfoRequest()
        req['info_type'] = info.INFO_TYPE
        req['file_info_class'] = info.INFO_CLASS
        req['file_id'] = handle.file_id
        req['buffer'] = info.pack()
        pending = self.connection.send(req, self.session.session_id, self.tree.tree_connect_id)
        self.connection.receive(pending)

    def close(self):
        self.connection.disconnect(close=True)


def metadata(handle, path, identity=None):
    return dict(name=path.split('/')[-1], relativePath=path,
                type='directory' if handle.file_attributes & 0x10 else 'file',
                sizeBytes=str(handle.end_of_file), modifiedAt=iso_ms(handle.last_write_time),
                hidden=bool(handle.file_attributes & 2) or path.split('/')[-1].startswith('.'),
                supported=True, objectId=identity)


def run(config):
    client = Client(config)
    try:
        action, path = config['action'], config.get('path', '')
        client.parents(path)
        if action in ('test', 'list'):
            folder = client.open(path, directory=True)
            entries = []
            while True:
                try:
                    batch = folder.query_directory('*', FileInformationClass.FILE_ID_BOTH_DIRECTORY_INFORMATION)
                except Exception as exc:
                    if getattr(exc, 'status', None) == 0x80000006:  # STATUS_NO_MORE_FILES
                        break
                    raise
                for entry in batch:
                    name = entry['file_name'].get_value().decode('utf-16-le')
                    if name in ('.', '..'):
                        continue
                    if action == 'test':
                        emit(result=dict(connected=True, dialect=hex(client.connection.dialect),
                                         encrypted=bool(client.session.encrypt_data)))
                        return
                    if len(entries) >= config['maxEntries']:
                        raise ValueError('DIRECTORY_TOO_LARGE')
                    attrs = entry['file_attributes'].get_value()
                    supported = not bool(attrs & 0x400)
                    try:
                        path_parts(name)
                    except ValueError:
                        supported = False
                    try:
                        object_id = str(entry['file_id'].get_value())
                    except Exception:
                        object_id = None
                        supported = False
                    entries.append(dict(name=name, relativePath='/'.join(filter(None, [path, name])),
                                        type='directory' if attrs & 0x10 else 'file',
                                        sizeBytes=str(entry['end_of_file'].get_value()),
                                        modifiedAt=iso_ms(entry['last_write_time'].get_value()),
                                        hidden=bool(attrs & 2) or name.startswith('.'), supported=supported,
                                        objectId=object_id))
            if action == 'test':
                emit(result=dict(connected=True, dialect=hex(client.connection.dialect),
                                 encrypted=bool(client.session.encrypt_data)))
            else:
                emit(result=entries)
        elif action == 'mkdir':
            handle = client.open(path, directory=True, create=True)
            emit(result=metadata(handle, path))
        elif action == 'rename':
            target = config.get('targetPath', '')
            source_parts, target_parts = path_parts(path), path_parts(target)
            if (not source_parts or not target_parts or source_parts[:-1] != target_parts[:-1]
                    or source_parts == target_parts
                    or is_reserved_name(source_parts[-1])
                    or is_reserved_name(target_parts[-1])):
                raise ValueError('INVALID_PATH')
            handle = client.open(path, delete=True)
            identity = client.identity(handle)
            if config.get('objectId') is not None and identity != config['objectId']:
                # The listed object was replaced underneath us; never rename the impostor.
                raise ValueError('OBJECT_CHANGED')
            info = FileRenameInformation()
            info['replace_if_exists'] = False
            info['file_name'] = '\\'.join(target_parts)
            client.set_info(handle, info)
            result = metadata(handle, target, identity)
            handle.close()
            emit(result=result)
        elif action == 'restore':
            # Recovery-only: move a registered reserved-name backup back to its
            # vacant note path after an interrupted replace swap.
            target = config.get('targetPath', '')
            source_parts, target_parts = path_parts(path), path_parts(target)
            if (not source_parts or not target_parts or source_parts[:-1] != target_parts[:-1]
                    or source_parts == target_parts
                    or not is_reserved_name(source_parts[-1])
                    or is_reserved_name(target_parts[-1])):
                raise ValueError('INVALID_PATH')
            handle = client.open(path, delete=True)
            identity = client.identity(handle)
            if identity != config['objectId']:
                raise ValueError('OBJECT_CHANGED')
            info = FileRenameInformation()
            info['replace_if_exists'] = False
            info['file_name'] = '\\'.join(target_parts)
            client.set_info(handle, info)
            result = metadata(handle, target, identity)
            handle.close()
            emit(result=result)
        elif action in ('delete', 'delete_object'):
            parts = path_parts(path)
            if not parts or is_reserved_name(parts[-1]):
                raise ValueError('INVALID_PATH')
            handle = client.open(path, delete=True)
            if action == 'delete_object' and client.identity(handle) != config['objectId']:
                raise ValueError('OBJECT_CHANGED')
            info = FileDispositionInformation()
            info['delete_pending'] = True
            client.set_info(handle, info)
            handle.close()
            emit(result=True)
        elif action in ('inspect', 'thumbnail'):
            Image, ImageFile = load_image_support()
            source = client.open(path, directory=False)
            if source.end_of_file > int(config.get('maxSourceBytes', 26214400)):
                raise ValueError('SIZE_LIMIT')
            parser = ImageFile.Parser()
            digest = hashlib.sha256()
            boundary = ImageContainerBoundary()
            offset = 0
            while offset < source.end_of_file:
                data = source.read(offset, min(1024 * 1024, client.connection.max_read_size,
                                               source.end_of_file - offset))
                if not data:
                    raise ValueError('TRANSFER_INTERRUPTED')
                parser.feed(data)
                digest.update(data)
                boundary.feed(data)
                offset += len(data)
            try:
                image = parser.close()
                media = IMAGE_FORMATS.get(image.format)
                if not media:
                    raise ValueError('UNSUPPORTED_IMAGE')
                expected_extension = config.get('expectedExtension')
                if expected_extension and expected_extension != media[1]:
                    if not (expected_extension == 'jpeg' and media[1] == 'jpg'):
                        raise ValueError('INVALID_IMAGE')
                boundary.validate(image.format)
            except ValueError:
                raise
            except Exception as exc:
                raise ValueError('INVALID_IMAGE') from exc
            if action == 'inspect':
                emit(result=dict(bytes=str(offset), objectId=client.identity(source),
                                 mediaType=media[0], extension=media[1],
                                 sha256=digest.hexdigest()))
                return
            try:
                image.seek(0)
                image.thumbnail((int(config.get('width', 640)), int(config.get('height', 480))))
                converted = image.convert('RGBA') if image.mode in ('RGBA', 'LA', 'P') else image.convert('RGB')
                output = io.BytesIO()
                converted.save(output, format='WEBP', quality=80, method=4)
                thumb = output.getvalue()
            except Exception as exc:
                raise ValueError('INVALID_IMAGE') from exc
            temp = config['tempPath']
            cache = config['cachePath']
            if path_parts(temp)[:-1] != path_parts(cache)[:-1] or not is_temporary_name(temp.split('/')[-1]):
                raise ValueError('INVALID_PATH')
            target = client.open(temp, directory=False, create=True, write=True, delete=True)
            written = target.write(thumb, 0)
            if written != len(thumb):
                raise ValueError('TRANSFER_INTERRUPTED')
            target.flush()
            info = FileRenameInformation()
            info['replace_if_exists'] = False
            info['file_name'] = '\\'.join(path_parts(cache))
            try:
                client.set_info(target, info)
            except Exception as exc:
                if getattr(exc, 'status', None) != 0xC0000035:
                    raise
                cleanup = FileDispositionInformation()
                cleanup['delete_pending'] = True
                client.set_info(target, cleanup)
            target.close()
            emit(ready=dict(name=cache.split('/')[-1], relativePath=cache, type='file',
                            sizeBytes=str(len(thumb)), modifiedAt=datetime.datetime.now().isoformat(),
                            hidden=True, supported=True))
            sys.stdout.buffer.write(thumb)
            sys.stdout.buffer.flush()
            emit(result=dict(bytes=str(len(thumb))))
        elif action in ('stat', 'read', 'cleanup'):
            handle = client.open(path, directory=False if action == 'read' else None, delete=action == 'cleanup')
            identity = client.identity(handle)
            if action == 'cleanup':
                if identity != config['objectId'] or not is_reserved_name(path.split('/')[-1]):
                    raise ValueError('OBJECT_CHANGED')
                info = FileDispositionInformation()
                info['delete_pending'] = True
                client.set_info(handle, info)
                handle.close()
                emit(result=True)
            elif action == 'stat':
                emit(result=metadata(handle, path, identity))
            else:
                emit(ready=metadata(handle, path, identity))
                offset, length = 0, handle.end_of_file
                while offset < length:
                    data = handle.read(offset, min(1024 * 1024, client.connection.max_read_size, length - offset))
                    if not data:
                        raise ValueError('TRANSFER_INTERRUPTED')
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                    offset += len(data)
                emit(result=dict(bytes=str(offset)))
        elif action == 'write':
            temp = config['tempPath']
            temp_name = temp.split('/')[-1]
            # noteTemp lets note creation reuse this no-overwrite commit with the reserved note prefix.
            allowed = is_temporary_name(temp_name) or (config.get('noteTemp') and is_note_temporary_name(temp_name))
            if path_parts(temp)[:-1] != path_parts(path)[:-1] or not allowed:
                raise ValueError('INVALID_PATH')
            handle = client.open(temp, directory=False, create=True, write=True, delete=True)
            identity = client.identity(handle)
            emit(created=dict(objectId=identity))
            expected, offset = int(config['size']), 0
            digest = hashlib.sha256() if config.get('validateImage') else None
            parser = None
            boundary = None
            if config.get('validateImage'):
                _, ImageFile = load_image_support()
                parser = ImageFile.Parser()
                boundary = ImageContainerBoundary()
            while offset < expected:
                data = sys.stdin.buffer.read(min(1024 * 1024, client.connection.max_write_size, expected - offset))
                if not data:
                    raise ValueError('TRANSFER_INTERRUPTED')
                written = handle.write(data, offset)
                if written != len(data):
                    raise ValueError('TRANSFER_INTERRUPTED')
                offset += written
                if digest:
                    digest.update(data)
                    parser.feed(data)
                    boundary.feed(data)
                emit(progress=str(offset))
            if sys.stdin.buffer.read(1):
                raise ValueError('SIZE_MISMATCH')
            handle.flush()
            prepared = dict(bytes=str(offset), objectId=identity)
            if parser:
                try:
                    image = parser.close()
                    media = IMAGE_FORMATS.get(image.format)
                    if not media:
                        raise ValueError('UNSUPPORTED_IMAGE')
                    if config.get('expectedExtension') and config['expectedExtension'] != media[1]:
                        if not (config['expectedExtension'] == 'jpeg' and media[1] == 'jpg'):
                            raise ValueError('INVALID_IMAGE')
                    boundary.validate(image.format)
                    prepared.update(mediaType=media[0], extension=media[1], sha256=digest.hexdigest())
                except Exception as exc:
                    if isinstance(exc, ValueError) and str(exc) == 'UNSUPPORTED_IMAGE':
                        raise
                    raise ValueError('INVALID_IMAGE') from exc
            emit(prepared=prepared)
            with os.fdopen(3, 'r') as control:
                if control.readline().strip() != 'commit':
                    raise ValueError('TRANSFER_INTERRUPTED')
            info = FileRenameInformation()
            info['replace_if_exists'] = False
            info['file_name'] = '\\'.join(path_parts(path))
            client.set_info(handle, info)
            handle.close()
            emit(result=dict(bytes=str(offset), objectId=identity))
        elif action == 'write_note':
            temp, backup = config['tempPath'], config.get('backupPath')
            expected = config.get('expected')
            if (backup is None
                    or path_parts(temp)[:-1] != path_parts(path)[:-1]
                    or path_parts(backup)[:-1] != path_parts(path)[:-1]
                    or temp == backup
                    or not is_note_temporary_name(temp.split('/')[-1])
                    or not is_note_temporary_name(backup.split('/')[-1])
                    or not isinstance(expected, dict)):
                raise ValueError('INVALID_PATH')
            # Pin the target with read-only sharing so external writers, deleters,
            # and replace-renames fail for the whole operation. DELETE access lets
            # this same pinned handle move the object during the swap below.
            try:
                target = client.open(path, directory=False, share=0x1, delete=True)
            except Exception as exc:
                status = getattr(exc, 'status', None)
                if status in (0xC0000034, 0xC000003A, 0xC00000BA):
                    raise ValueError('OBJECT_CHANGED') from exc
                raise
            unchanged = lambda: (
                client.stat_info(target) == (expected.get('objectId'),
                                             str(expected.get('sizeBytes')),
                                             expected.get('modifiedAt')))
            if not unchanged():
                raise ValueError('OBJECT_CHANGED')
            handle = client.open(temp, directory=False, create=True, write=True, delete=True)
            identity = client.identity(handle)
            emit(created=dict(objectId=identity))
            expected_size, offset = int(config['size']), 0
            digest = hashlib.sha256()
            while offset < expected_size:
                data = sys.stdin.buffer.read(min(1024 * 1024, client.connection.max_write_size,
                                                 expected_size - offset))
                if not data:
                    raise ValueError('TRANSFER_INTERRUPTED')
                written = handle.write(data, offset)
                if written != len(data):
                    raise ValueError('TRANSFER_INTERRUPTED')
                digest.update(data)
                offset += written
                emit(progress=str(offset))
            if sys.stdin.buffer.read(1):
                raise ValueError('SIZE_MISMATCH')
            handle.flush()
            emit(prepared=dict(bytes=str(offset), objectId=identity, sha256=digest.hexdigest()))
            with os.fdopen(3, 'r') as control:
                if control.readline().strip() != 'commit':
                    raise ValueError('TRANSFER_INTERRUPTED')
            # Nothing could have modified the pinned target since the first check,
            # so this re-check only closes the remaining in-place write window.
            if not unchanged():
                raise ValueError('OBJECT_CHANGED')
            # Conditional replace as an identity-checked swap: the pinned target is
            # renamed to its registered backup, the staged file claims the note name
            # with a no-overwrite rename, and only after the final identity match is
            # the backup released. A concurrent external change can never be silently
            # overwritten: while the pin holds, every competing writer fails, and the
            # no-overwrite rename turns a post-pin race into a loud OBJECT_CHANGED
            # that rolls the original back into place.
            away = FileRenameInformation()
            away['replace_if_exists'] = False
            away['file_name'] = '\\'.join(path_parts(backup))
            client.set_info(target, away)
            try:
                into = FileRenameInformation()
                into['replace_if_exists'] = False
                into['file_name'] = '\\'.join(path_parts(path))
                client.set_info(handle, into)
            except Exception as exc:
                try:
                    back = FileRenameInformation()
                    back['replace_if_exists'] = False
                    back['file_name'] = '\\'.join(path_parts(path))
                    client.set_info(target, back)
                except Exception:
                    pass  # Recovery restores the registered backup by identity.
                if getattr(exc, 'status', None) == 0xC0000035:
                    raise ValueError('OBJECT_CHANGED') from exc
                raise
            # Release the staged handle first: it holds DELETE access without
            # delete sharing, which would collide with this verification open.
            handle.close()
            final = client.open(path, directory=False)
            final_identity = client.identity(final)
            if final_identity != identity:
                # The rename landed on a different object; never sign a foreign file.
                raise ValueError('OBJECT_CHANGED')
            result = dict(bytes=str(offset), objectId=final_identity, sha256=digest.hexdigest(),
                          sizeBytes=str(final.end_of_file),
                          modifiedAt=iso_ms(final.last_write_time))
            residual = False
            try:
                cleanup = FileDispositionInformation()
                cleanup['delete_pending'] = True
                client.set_info(target, cleanup)
            except Exception:
                # The staged note is in place; the backup stays registered for the
                # server's identity-based cleanup instead of failing the save.
                residual = True
            emit(result={**result, 'residual': residual})
        else:
            raise ValueError('INVALID_OPERATION')
    finally:
        client.close()


if __name__ == '__main__':
    try:
        # Credentials never enter argv, environment, tracebacks, or protocol library logs.
        first = sys.stdin.buffer.readline(65536)
        config = json.loads(first)
        run(config)
    except Exception as exc:
        status = getattr(exc, 'status', None)
        code = {
            0xC000006D: 'SMB_CREDENTIALS_INVALID', 0xC000006A: 'SMB_CREDENTIALS_INVALID',
            0xC0000234: 'SMB_CREDENTIALS_INVALID', 0xC0000072: 'SMB_CREDENTIALS_INVALID',
            0xC0000022: 'SMB_ACCESS_DENIED', 0xC0000034: 'PATH_NOT_FOUND',
            0xC000003A: 'PATH_NOT_FOUND', 0xC00000CC: 'SMB_ROOT_UNAVAILABLE',
            0xC0000035: 'NAME_CONFLICT', 0xC000007F: 'SMB_DISK_FULL',
            0xC0000101: 'DIRECTORY_NOT_EMPTY',
            0x8000002D: 'UNSUPPORTED_LINK', 0xC0000257: 'UNSUPPORTED_LINK',
            0xC0000043: 'FILE_BUSY',
        }.get(status, 'SMB_UNAVAILABLE')
        if isinstance(exc, ValueError) and str(exc) in {
            'INVALID_PATH', 'SMB_SECURITY_REQUIRED', 'UNSUPPORTED_LINK', 'DIRECTORY_TOO_LARGE',
            'OBJECT_CHANGED', 'TRANSFER_INTERRUPTED', 'SIZE_MISMATCH', 'INVALID_OPERATION',
            'INVALID_IMAGE', 'UNSUPPORTED_IMAGE', 'SIZE_LIMIT',
        }:
            code = str(exc)
        emit(error=code)
        sys.exit(1)
