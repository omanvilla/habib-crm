"""Execute the pre-existing full SQL acceptance steps in separate CI Postgres jobs.
No assertions, fixtures, migration or rollback sources are edited for this release.
"""
import os
import pathlib
import subprocess
import yaml

path = '.github/workflows/crm-preview-validation.yml'
baseline = subprocess.check_output(['git', 'show', '70f413f9e5e95824f8237ffc99a52a5418d78c33:' + path])
assert pathlib.Path(path).read_bytes() == baseline, 'SQL test workflow must remain unchanged'
job = os.environ['AUDIT_SQL_SUITE']
assert job in ['attribution-sql', 'workflows-sql', 'investment-sql', 'reservations-sql', 'comprehensive-audit-sql']
suite = yaml.safe_load(baseline)['jobs'][job]
for i, step in enumerate(suite['steps']):
    if 'run' not in step:
        continue  # checkout/setup-node are provided by the enclosing job.
    assert not step.get('if'), 'Conditional step needs explicit handling'
    env = dict(os.environ)
    env.update({str(k): str(v) for k, v in suite.get('env', {}).items()})
    env.update({str(k): str(v) for k, v in step.get('env', {}).items()})
    print('::group::' + job + ': ' + step.get('name', 'step ' + str(i)), flush=True)
    subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', step['run']], env=env, check=True)
    print('::endgroup::', flush=True)
