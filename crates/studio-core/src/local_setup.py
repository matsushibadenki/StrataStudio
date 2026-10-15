# Executed inside Strata's isolated venv. Inputs are a validated, owned symlink view.
import sys, importlib.util
from pathlib import Path
root, stage, data = map(Path, sys.argv[1:4])
sys.path.insert(0, str(root))
spec = importlib.util.spec_from_file_location('studio_metal_setup', root / 'metal/setup_mac.py')
metal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metal)
S = metal.S
original_done, original_download = S.done, S.download
# A missing .done sidecar in another app's store must never cause a re-download.
S.done = lambda p: True if Path(p).parent == stage and Path(p).is_file() else original_done(p)
def download(url, destination, *args, **kwargs):
    if not str(destination).lower().endswith(('.zip', '.tar.gz', '.tar.xz')):
        raise RuntimeError('Local reuse forbids model/auxiliary weight downloads: ' + str(destination))
    return original_download(url, destination, *args, **kwargs)
S.download = download
# Upstream data_folder may move files from earlier installs; use our isolated workspace instead.
def data_folder(_requested):
    data.mkdir(parents=True, exist_ok=True)
    return data, []
S.data_folder = data_folder
# MTP is optional and can fetch a separate checkpoint through a subprocess. No weight downloads in reuse mode.
metal.stream_mtp = lambda *_args: False
raise SystemExit(metal.main(['--yes', '--setup', '--no-start', '--no-browser', '--vision', 'no', '--model', sys.argv[4], '--context', sys.argv[5], '--gguf-dir', str(stage), '--data-dir', str(data)]))
