"""
RunPy - Python Playground Backend
Handles real-time code execution, pip installs, and variable inspection
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os

# Force headless Matplotlib backend for thread-safety and macOS stability
os.environ['MPLBACKEND'] = 'Agg'
try:
    import matplotlib
    matplotlib.use('Agg')
except ImportError:
    pass

import io
from contextlib import redirect_stdout, redirect_stderr
import traceback
import subprocess
import threading
import time
import ast
import json
import dis

app = Flask(__name__)
CORS(app)

# Persistent execution environment across runs
persistent_env = {}
env_lock = threading.Lock()

def safe_repr(val, depth=0):
    """Smart repr for output panel - truncates huge objects."""
    if depth > 2:
        return "..."
    try:
        if isinstance(val, (int, float, bool, type(None))):
            return repr(val)
        if isinstance(val, str):
            if len(val) > 500:
                return repr(val[:500]) + f"... (+{len(val)-500} chars)"
            return repr(val)
        if isinstance(val, (list, tuple)):
            t = type(val)
            if len(val) == 0:
                return repr(val)
            items = [safe_repr(v, depth+1) for v in val[:20]]
            s = (", ".join(items))
            if len(val) > 20:
                s += f", ... (+{len(val)-20} more)"
            brackets = ("[]" if t is list else "()")
            return brackets[0] + s + brackets[1]
        if isinstance(val, dict):
            if len(val) == 0:
                return "{}"
            items = [f"{safe_repr(k, depth+1)}: {safe_repr(v, depth+1)}" for k, v in list(val.items())[:10]]
            s = ", ".join(items)
            if len(val) > 10:
                s += f", ... (+{len(val)-10} more)"
            return "{" + s + "}"
        if isinstance(val, set):
            if len(val) == 0:
                return "set()"
            items = [safe_repr(v, depth+1) for v in list(val)[:10]]
            return "{" + ", ".join(items) + ("}" if len(val) <= 10 else f", ... (+{len(val)-10} more)}}")
        r = repr(val)
        if len(r) > 300:
            return r[:300] + "..."
        return r
    except Exception:
        return "<unrepresentable>"


def get_last_expr_value(code, local_env):
    """Try to get the value of the last expression in the code."""
    try:
        tree = ast.parse(code)
        if not tree.body:
            return None, False
        last = tree.body[-1]
        if isinstance(last, ast.Expr):
            # Evaluate just the last expression
            expr_code = ast.unparse(last.value)
            try:
                val = eval(expr_code, local_env)
                return val, True
            except Exception:
                return None, False
    except Exception:
        pass
    return None, False


def execute_code(code, use_persistent=True):
    """Execute Python code, capturing stdout/stderr."""
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    start = time.time()
    result = {
        "stdout": "",
        "stderr": "",
        "error": None,
        "exec_time": 0,
        "has_last_value": False,
        "variables": {},
        "internals": "",
        "plots": []
    }

    with env_lock:
        env = persistent_env if use_persistent else {}

    # Inject display helpers
    exec_globals = dict(env)
    exec_globals["__builtins__"] = __builtins__

    try:
        with (
            redirect_stdout(stdout_capture),
            redirect_stderr(stderr_capture)
        ):
            compiled_code = compile(code, "<runpy>", "exec")
            
            # Capture disassembly
            dis_io = io.StringIO()
            dis.dis(compiled_code, file=dis_io)
            result["internals"] = dis_io.getvalue()
            
            exec(compiled_code, exec_globals)

        # Update persistent env
        if use_persistent:
            with env_lock:
                for k, v in exec_globals.items():
                    if not k.startswith("__"):
                        persistent_env[k] = v

        # Capture last expression value
        val, has_val = get_last_expr_value(code, exec_globals)
        if has_val and val is not None:
            result["last_value"] = safe_repr(val)
            result["has_last_value"] = True

        # Snapshot of user variables
        snap = {}
        for k, v in exec_globals.items():
            if not k.startswith("__") and k not in ("In", "Out", "get_ipython", "exit", "quit"):
                try:
                    t = type(v).__name__
                    r = safe_repr(v)
                    snap[k] = {"type": t, "repr": r}
                except Exception:
                    pass
        # Capture Plots if matplotlib is used
        if "matplotlib" in sys.modules:
            try:
                import matplotlib.pyplot as plt
                import base64
                
                figs = plt.get_fignums()
                for num in figs:
                    buf = io.BytesIO()
                    fig = plt.figure(num)
                    fig.savefig(buf, format="png", bbox_inches='tight')
                    buf.seek(0)
                    img_b64 = base64.b64encode(buf.read()).decode('utf-8')
                    result["plots"].append(img_b64)
                    plt.close(fig)
            except Exception:
                pass

        result["variables"] = snap

    except SyntaxError as e:
        result["error"] = {
            "type": "SyntaxError",
            "message": str(e),
            "line": e.lineno,
            "offset": e.offset,
        }
    except Exception as e:
        tb = traceback.format_exc()
        result["error"] = {
            "type": type(e).__name__,
            "message": str(e),
            "traceback": tb
        }

    result["stdout"] = stdout_capture.getvalue()
    result["stderr"] = stderr_capture.getvalue()
    result["exec_time"] = round((time.time() - start) * 1000, 2)
    return result


@app.route("/run", methods=["POST"])
def run():
    data = request.json
    code = data.get("code", "")
    persistent = data.get("persistent", True)
    if not code.strip():
        return jsonify({"stdout": "", "stderr": "", "error": None, "exec_time": 0, "variables": {}})
    result = execute_code(code, use_persistent=persistent)
    return jsonify(result)


@app.route("/reset", methods=["POST"])
def reset():
    with env_lock:
        persistent_env.clear()
    return jsonify({"ok": True})


@app.route("/install", methods=["POST"])
def install():
    data = request.json
    packages = data.get("packages", "")
    if not packages.strip():
        return jsonify({"ok": False, "output": "No package specified"})
    pkgs = [p.strip() for p in packages.split() if p.strip()]
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "install"] + pkgs,
            capture_output=True, text=True, timeout=60
        )
        output = proc.stdout + proc.stderr
        ok = proc.returncode == 0
        return jsonify({"ok": ok, "output": output, "packages": pkgs})
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "output": "Timeout: install took too long"})
    except Exception as e:
        return jsonify({"ok": False, "output": str(e)})


@app.route("/vars", methods=["GET"])
def vars_snapshot():
    with env_lock:
        snap = {}
        for k, v in persistent_env.items():
            if not k.startswith("__"):
                try:
                    snap[k] = {"type": type(v).__name__, "repr": safe_repr(v)}
                except Exception:
                    pass
    return jsonify(snap)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "python": sys.version})


if __name__ == "__main__":
    print("RunPy backend running on http://localhost:5822")
    app.run(port=5822, debug=False, threaded=True)
