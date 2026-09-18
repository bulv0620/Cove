"""One isolated SMB session per operation. JSON control over pipes; bytes never staged locally."""
import datetime
import json
import logging
import os
import re
import sys
import uuid

from smbprotocol.connection import Connection, Dialects
from smbprotocol.session import Session
from smbprotocol.tree import TreeConnect
from smbprotocol.open import (
    Open, CreateOptions, CreateDisposition, FileAttributes, ImpersonationLevel,
    SMB2QueryInfoRequest, SMB2QueryInfoResponse, SMB2SetInfoRequest,
)
from smbprotocol.file_info import (
    FileInformationClass, FileInternalInformation, FileRenameInformation, FileDispositionInformation,
)

logging.disable(logging.CRITICAL)


TEMP_PREFIX = '.cove-upload-'


def is_temporary_name(name):
    return name.lower().startswith(TEMP_PREFIX)


def emit(**event):
    sys.stderr.write(json.dumps(event, ensure_ascii=True) + '\n')
    sys.stderr.flush()


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

    def open(self, path, directory=None, create=False, write=False, delete=False):
        handle = Open(self.tree, '\\'.join(path_parts(path)))
        options = CreateOptions.FILE_OPEN_REPARSE_POINT
        if directory is not None:
            options |= CreateOptions.FILE_DIRECTORY_FILE if directory else CreateOptions.FILE_NON_DIRECTORY_FILE
        # READ_ATTRIBUTES | SYNCHRONIZE | READ_DATA; writers add WRITE_DATA and DELETE.
        access = 0x100081 | (0x2 if write else 0) | (0x10000 if delete else 0)
        handle.create(ImpersonationLevel.Impersonation, access, FileAttributes.FILE_ATTRIBUTE_NORMAL,
                      0x3, CreateDisposition.FILE_CREATE if create else CreateDisposition.FILE_OPEN, options)
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
                sizeBytes=str(handle.end_of_file), modifiedAt=handle.last_write_time.isoformat(),
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
                    entries.append(dict(name=name, relativePath='/'.join(filter(None, [path, name])),
                                        type='directory' if attrs & 0x10 else 'file',
                                        sizeBytes=str(entry['end_of_file'].get_value()),
                                        modifiedAt=entry['last_write_time'].get_value().isoformat(),
                                        hidden=bool(attrs & 2) or name.startswith('.'), supported=supported))
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
                    or is_temporary_name(source_parts[-1])
                    or is_temporary_name(target_parts[-1])):
                raise ValueError('INVALID_PATH')
            handle = client.open(path, delete=True)
            identity = client.identity(handle)
            info = FileRenameInformation()
            info['replace_if_exists'] = False
            info['file_name'] = '\\'.join(target_parts)
            client.set_info(handle, info)
            result = metadata(handle, target, identity)
            handle.close()
            emit(result=result)
        elif action == 'delete':
            parts = path_parts(path)
            if not parts or is_temporary_name(parts[-1]):
                raise ValueError('INVALID_PATH')
            handle = client.open(path, delete=True)
            info = FileDispositionInformation()
            info['delete_pending'] = True
            client.set_info(handle, info)
            handle.close()
            emit(result=True)
        elif action in ('stat', 'read', 'cleanup'):
            handle = client.open(path, directory=False if action == 'read' else None, delete=action == 'cleanup')
            identity = client.identity(handle)
            if action == 'cleanup':
                if identity != config['objectId'] or not is_temporary_name(path.split('/')[-1]):
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
            if path_parts(temp)[:-1] != path_parts(path)[:-1] or not is_temporary_name(temp.split('/')[-1]):
                raise ValueError('INVALID_PATH')
            handle = client.open(temp, directory=False, create=True, write=True, delete=True)
            identity = client.identity(handle)
            emit(created=dict(objectId=identity))
            expected, offset = int(config['size']), 0
            while offset < expected:
                data = sys.stdin.buffer.read(min(1024 * 1024, client.connection.max_write_size, expected - offset))
                if not data:
                    raise ValueError('TRANSFER_INTERRUPTED')
                written = handle.write(data, offset)
                if written != len(data):
                    raise ValueError('TRANSFER_INTERRUPTED')
                offset += written
                emit(progress=str(offset))
            if sys.stdin.buffer.read(1):
                raise ValueError('SIZE_MISMATCH')
            handle.flush()
            emit(prepared=dict(bytes=str(offset), objectId=identity))
            with os.fdopen(3, 'r') as control:
                if control.readline().strip() != 'commit':
                    raise ValueError('TRANSFER_INTERRUPTED')
            info = FileRenameInformation()
            info['replace_if_exists'] = False
            info['file_name'] = '\\'.join(path_parts(path))
            client.set_info(handle, info)
            handle.close()
            emit(result=dict(bytes=str(offset), objectId=identity))
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
        }:
            code = str(exc)
        emit(error=code)
        sys.exit(1)
