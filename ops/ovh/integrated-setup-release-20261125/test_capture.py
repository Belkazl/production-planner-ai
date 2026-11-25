"""Pure bounded transport tests; no SSH, private sources or infrastructure."""
import importlib.util
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('setup_capture', Path(__file__).with_name('capture.py'))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def test_only_exact_app_sources_cross_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.bundle'
            expected = {name: b'public synthetic source' for name in (*capture.APP_FILES, 'manifest.json')}
            with path.open('wb') as stream:
                capture.write_bundle(stream, expected)
            self.assertEqual(capture.read_bundle(path), expected)

    def test_unknown_files_paths_and_symlinks_are_rejected(self):
        for name, kind in [('credentials.json', tarfile.REGTYPE),
                           ('../python-ga-upstream.mjs', tarfile.REGTYPE),
                           ('python-ga-upstream.mjs', tarfile.SYMTYPE)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'app.bundle'
                with tarfile.open(path, 'w') as archive:
                    member = tarfile.TarInfo(name)
                    member.type, member.size = kind, 1
                    archive.addfile(member, io.BytesIO(b'x'))
                with self.assertRaises(capture.CaptureError):
                    capture.read_bundle(path)

    def test_duplicate_members_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.bundle'
            with tarfile.open(path, 'w') as archive:
                for _ in range(2):
                    member = tarfile.TarInfo('python-ga-upstream.mjs'); member.size = 1
                    archive.addfile(member, io.BytesIO(b'x'))
            with self.assertRaises(capture.CaptureError):
                capture.read_bundle(path)


if __name__ == '__main__':
    unittest.main()
