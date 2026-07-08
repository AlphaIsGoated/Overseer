#!/usr/bin/env python3
"""
Auto-bump the version in settings.html using recent git commit messages.
Only runs when there are real commits since the last auto-bump.
Called by the Claude Code Stop hook after each session.
"""
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETTINGS = ROOT / 'settings.html'
TODAY = date.today().isoformat()


def git(*args):
    try:
        return subprocess.check_output(
            ['git', '-C', str(ROOT)] + list(args),
            stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return ''


def get_new_commits():
    """Return commit messages since the last auto-bump commit."""
    last_bump = git('log', '--grep=auto bump version', '--format=%H', '-1')
    if last_bump:
        log = git('log', '--format=%s', f'{last_bump}..HEAD').splitlines()
    else:
        log = git('log', '--format=%s', '-20').splitlines()

    skip = ('auto bump version', 'co-authored', 'chore: bump')
    commits = []
    for msg in log:
        msg = msg.strip()
        if not msg:
            continue
        if any(p in msg.lower() for p in skip):
            continue
        commits.append(msg)
        if len(commits) >= 7:
            break
    return commits


def js_str(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def main():
    if not SETTINGS.exists():
        print('settings.html not found, skipping'); sys.exit(0)

    # If settings.html already has uncommitted changes, a bump is pending commit — skip.
    diff = git('diff', 'settings.html')
    if diff:
        print('settings.html already has uncommitted version bump, skipping'); sys.exit(0)

    commits = get_new_commits()
    if not commits:
        print('No new commits since last version bump, skipping'); sys.exit(0)

    content = SETTINGS.read_bytes()
    text = content.decode('utf-8')

    # Find all versions in CHANGELOG array
    vers = re.findall(r"ver:\s*'([0-9]+\.[0-9]+)'", text)
    if not vers:
        print('No version found in settings.html, skipping'); sys.exit(0)

    def ver_key(v):
        parts = v.split('.')
        return (int(parts[0]), int(parts[1]))

    current = max(vers, key=ver_key)
    major, minor = current.split('.')
    new_ver = f'{major}.{int(minor) + 1}'

    # Build new CHANGELOG entry
    items_js = ', '.join(js_str(c) for c in commits)
    new_entry = f"    {{ ver: '{new_ver}', date: '{TODAY}', items: [{items_js}] }},\n"

    # Insert right after "const CHANGELOG = ["
    new_text = re.sub(
        r'(const CHANGELOG\s*=\s*\[)',
        r'\1\n' + new_entry,
        text,
        count=1
    )
    if new_text == text:
        print('Could not locate CHANGELOG array, skipping'); sys.exit(0)

    # Update inline "Version X.X —" display string
    new_text = new_text.replace(f'Version {current} —', f'Version {new_ver} —', 1)

    new_bytes = new_text.encode('utf-8')
    if new_bytes == content:
        print('No change needed'); sys.exit(0)

    SETTINGS.write_bytes(new_bytes)
    print(f'Bumped {current} -> {new_ver}  ({len(commits)} changelog items)')


if __name__ == '__main__':
    main()
