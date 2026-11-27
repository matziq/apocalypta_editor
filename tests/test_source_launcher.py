import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == "nt", "Windows batch launcher")
class SourceLauncherTests(unittest.TestCase):
    def test_interpreter_fallback_and_failure_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "editor files"
            commands = root / "commands"
            app.mkdir()
            commands.mkdir()
            shutil.copyfile(Path(__file__).resolve().parents[1] / "run.bat", app / "run.bat")
            (app / "native_gui.py").write_text("", encoding="ascii")
            (commands / "py.cmd").write_text(
                '@echo off\n'
                'if "%~2"=="-c" if "%~1"=="-3.12" exit /b %PROBE312%\n'
                'if "%~2"=="-c" if "%~1"=="-3" exit /b %PROBE3%\n'
                'echo selected %1 %2 %3\n'
                'exit /b %RUN_RESULT%\n', encoding="ascii")
            (commands / "python.cmd").write_text(
                '@echo off\n'
                'echo selected python %1 %2\n'
                'exit /b %RUN_RESULT%\n', encoding="ascii")
            env = os.environ.copy()
            env["PATH"] = str(commands) + ";" + str(Path(os.environ["SystemRoot"]) / "System32")
            env.update(PROBE312="0", PROBE3="0", RUN_RESULT="0")

            def launch():
                return subprocess.run(
                    [os.environ["COMSPEC"], "/d", "/c", str(app / "run.bat"), "--sample"],
                    cwd=root, env=env, input="\n", text=True, capture_output=True, check=False)

            result = launch()
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("selected -3.12", result.stdout)
            self.assertIn("--sample", result.stdout)
            env["PROBE312"] = "1"
            result = launch()
            self.assertEqual(result.returncode, 0)
            self.assertIn("selected -3 ", result.stdout)
            env["PROBE3"] = "1"
            result = launch()
            self.assertEqual(result.returncode, 0)
            self.assertIn("selected python ", result.stdout)
            env["RUN_RESULT"] = "13"
            result = launch()
            self.assertEqual(result.returncode, 13)
            self.assertIn("press any key", result.stdout)
            self.assertIn("exit code 13", result.stderr)


if __name__ == "__main__":
    unittest.main()
