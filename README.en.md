# ship-gotchas

> **The bugs your machine cannot show you.**
> Every entry cites a source, and CI checks the sources — if a vendor changes
> its documentation, this repository goes red.

[English](README.en.md) · [简体中文](README.md)

---

## Why this exists

Local tests green. Lint clean. Artifacts built. Then you publish, and it breaks
on the first machine that isn't yours.

These failures share one property: **your development environment is missing
nothing, so the defect has nowhere to appear.** Your git checkout has every
file. Your filesystem is case-sensitive. Your shell is bash. The one thing
that's absent is exactly the trigger.

Each entry follows the same shape: symptom, why it hides locally, how to check,
how to fix, how to stop it coming back, and the source.

---

## Contents

1. [The sdist is missing files — only `tests/test*.py` is included by default](#1-the-sdist-is-missing-files)
2. [Command order in `MANIFEST.in` changes the result](#2-command-order-in-manifestin-changes-the-result)
3. [Run the test suite from an unpacked sdist](#3-run-the-test-suite-from-an-unpacked-sdist)
4. [A path bug that only breaks on Windows](#4-a-path-bug-that-only-breaks-on-windows)
5. [On PyPI, "Owner" means the GitHub account, not your PyPI username](#5-on-pypi-owner-means-the-github-account)
6. [A pending publisher does not reserve the project name](#6-a-pending-publisher-does-not-reserve-the-project-name)
7. [PowerShell split one argument into three](#7-powershell-split-one-argument-into-three)
8. [Check CI before you release, not just your laptop](#8-check-ci-before-you-release)
9. [A self-referential test is not verification](#9-a-self-referential-test-is-not-verification)
10. [Fixtures must be read back and verified](#10-fixtures-must-be-read-back-and-verified)

The detailed write-ups are in Chinese in [README.md](README.md); this page
covers the same ten entries in shorter form.

---

### 1. The sdist is missing files

**Symptom.** Installing from the sdist and running the tests dies during
collection: `ModuleNotFoundError: No module named 'support'`. The same suite is
green in your repository.

**Why it hides.** The file isn't in the sdist, and your git checkout has
everything, so the tests never run against the incomplete tree.

setuptools lists what enters an sdist by default. For tests, exactly one rule:

> Files that match the following glob patterns: `tests/test*.py`, `test/test*.py`

So `tests/support.py`, `tests/conftest.py` and anything else under `tests/`
stays out.

**Why it matters.** Homebrew, Debian and conda-forge all build *from the sdist*
and run the suite. A sdist missing files is broken for every downstream
packager, and you will never see it yourself.

**Fix.** Add `MANIFEST.in`:

```
recursive-include tests *
recursive-include examples *
```

**Prevent.** A CI job that unpacks the sdist and runs the tests from it — the
only way to see this from outside your machine. See
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

**Source.** [setuptools — Controlling files in the distribution](https://setuptools.pypa.io/en/latest/userguide/miscellaneous.html) · verified

---

### 2. Command order in `MANIFEST.in` changes the result

**Symptom.** You added `recursive-include examples *` and the sdist picked up
`examples/__pycache__/*.pyc`.

**Why it hides.** It only happens if *you* have run the example scripts and left
bytecode behind. CI builds from a fresh checkout, so CI is clean, your machine
is dirty, and nobody diffs the two.

**Check.** Compare the published sdist against a locally built one:

```bash
pip download your-package --no-deps --no-binary :all: -d /tmp/published
diff <(tar tzf /tmp/published/*.tar.gz | sort) <(tar tzf dist/*.tar.gz | sort)
```

**Fix.** The setuptools docs explain the ordering and show the canonical form:

```
graft tests
global-exclude *.py[cod]
```

> If the commands were in the opposite order, then `*.pyc` files would only be
> removed from what was already in the sdist before adding `tests`.

`global-exclude` must come **after** every `include`/`graft`.

**Prevent.** Assert in CI that the sdist contains no bytecode.

**Source.** [setuptools — Controlling files in the distribution](https://setuptools.pypa.io/en/latest/userguide/miscellaneous.html) · verified

---

### 3. Run the test suite from an unpacked sdist

No symptom. That is the point — this is the precondition that makes entry 1
findable.

`pip install -e .` installs your working tree, not the sdist. What you test is
never what you publish. Build the sdist, unpack it into a temp directory, and
run the suite **there**. All three steps; drop one and you are testing the
working tree again.

This is its own entry because its value is in the *next* change: once entry 1 is
fixed, nothing stops someone from adding another non-`test*.py` file to
`tests/`.

**Source.** Practice of this repository · verified (reproducible)

---

### 4. A path bug that only breaks on Windows

**Symptom.** Linux and macOS green; on Windows:

```
AssertionError: Items in the second set but not the first: 'src/a.py'
```

**Why it hides.** The trigger cannot exist on POSIX. The real code was:

```python
def is_inside(root, repo):
    real_root = os.path.realpath(root)
    return real_root == repo or real_root.startswith(os.path.join(repo, ""))
```

One side went through `realpath`, the other did not. On POSIX
`realpath("/repo")` is still `"/repo"`, so both sides agree and the function
looks correct. On Windows it is `D:\repo`, and the comparison never matches.

More tests won't help — this is an environment difference, not a coverage gap.

**Check.** Don't test one path shape. Make the resolved path *differ* from the
input, then see whether the function still holds:

```python
def test_path_normalisation(self):
    real = os.path.realpath(tmp)
    link = os.path.join(real, "link")
    os.symlink(real, link, target_is_directory=True)   # realpath(x) != x
    self.assertTrue(is_inside(os.path.join(link, "sub"), link))
```

This is the valuable part of the entry: it moves the "Windows-only" condition
onto Linux, so the regression is pinned locally instead of waiting for a Windows
runner you then have to read logs from.

**Fix.** Normalise both sides with `os.path.normcase(os.path.realpath(path))`.

**Prevent.** Include Windows in the matrix — and actually look at it before
releasing (entry 8).

**Source.** [Python — `os.path.normcase`](https://docs.python.org/3/library/os.path.html) · verified

---

### 5. On PyPI, "Owner" means the GitHub account

**Symptom.** The trusted publisher is configured and the OIDC exchange fails.
**The error will not tell you which field is wrong.**

**Why it's easy to get wrong.** The field is called "Owner" and reads like "my
username". It actually asks for the GitHub user or organisation that owns the
repository. The PyPI docs put it as:

> If you have a repository at `https://github.com/octo-org/sampleproject` …

`octo-org` is what goes in that box. Your PyPI username does not appear in this
form at all — the publisher is already tied to the account you are logged in as,
which is what "pending" means.

**Fix.**

| Field | What goes in it |
| --- | --- |
| PyPI Project Name | the project name, ASCII only |
| **Owner** | **the GitHub user or organisation** |
| Repository name | the repository name alone — not `owner/repo` |
| Workflow name | the workflow **filename** (`release.yml`), not its `name:` |
| Environment name | the workflow's `environment.name` |

**Source.** [PyPI Docs — Creating a project with a Trusted Publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/) · verified

---

### 6. A pending publisher does not reserve the project name

"Pending" sounds like "reserved". The documentation says the opposite:

> A "pending" publisher **does not** create a project or reserve a project's
> name **until** it is actually used to publish. If you create a "pending"
> publisher but another user registers the project name before you actually
> publish to it, your "pending" publisher will be **invalidated**.

So the name is claimed at the first successful publish, not at configuration
time. Configure, then publish promptly.

Two related things worth doing while choosing a name:

- **Check availability via the API, not the web page**:
  `https://pypi.org/pypi/<name>/json` returning 404 means free.
- **Check neighbouring names too.** PyPI runs a similarity check at upload time,
  so a name one transposition away from an existing project (`packctx` against a
  taken `ctxpack`) can be rejected outright. Checking neighbours beats being
  refused at upload.

**Source.** [PyPI Docs — Creating a project with a Trusted Publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/) · verified

---

### 7. PowerShell split one argument into three

**Symptom.** Passing a block of multi-line text as an argument to a CLI program
on Windows PowerShell:

```
accepts 1 arg(s), received 3
```

Neither the command nor the value is wrong.

**Why.** PowerShell builds a command line string and hands it to the native
program. From the official documentation:

> When running native commands from PowerShell, the arguments are first parsed
> by PowerShell. The parsed arguments are then joined into a single string with
> each parameter separated by a space.

How values containing whitespace get quoted during that join depends on the
version and on `$PSNativeCommandArgumentPassing`. The result is one argument
arriving as three.

**Fix.** Stop fighting the quoting and use standard input, which bypasses
argument parsing entirely:

```bash
git tag -l --format="%(contents)" v1.0.0 | gh release edit v1.0.0 --notes-file -
```

`--notes-file -` reads from stdin.

**Related.** Never paste a `<placeholder>` into PowerShell. `<` is a reserved
operator there; the error is `RedirectionNotSupported` and has nothing to do
with your command.

**Source.** [Microsoft Learn — about_Parsing](https://learn.microsoft.com/zh-cn/powershell/module/microsoft.powershell.core/about/about_parsing) · verified

---

### 8. Check CI before you release

**Symptom.** 152 local tests green, lint clean, `twine check` passes, the wheel
installs and runs. **CI is red.**

This is its own entry because it is the last gate. On this repository's own
record: everything was green locally while the Windows job failed on `Run
tests`, for the reason in entry 4. Publishing without looking would have pinned
a broken version to a release.

**Check.**

```bash
gh run list --limit 5     # read the CONCLUSION column
```

**Fix.** Confirm the commit's CI is green *before* pushing the tag. When it is
red, fetch the logs rather than pasting them around:

```bash
gh run view --log-failed | Out-File -Encoding utf8 ci-failure.txt
```

Anonymous GitHub API calls cannot read Actions logs (403), so go through `gh`.

**Source.** Practice of this repository · verified (reproducible)

---

### 9. A self-referential test is not verification

**Symptom.** Tests are green and you have verified nothing, because **the
assertion and the implementation are making the same mistake.**

**Why it hides.** This is a flaw in the reasoning, not the environment — which
makes it more dangerous than the entries above, because more tests make it
*more* convincing.

**The example.** Testing "stripping metadata does not alter the image" the
obvious way:

```js
const before = readSegments(photo);
const after = readSegments(stripped);
assert.deepEqual(strippedScan(after), originalScan(before));
```

If `readSegments` — my own container walker — miscalculates where the scan data
begins, then producing and comparing the values are wrong *together*, and the
assertion still passes. The test covers my implementation's agreement with
itself.

**Fix.** Verify with **another implementation**. JPEG is lossy, so any
re-encode, or a dropped quantisation or Huffman table, changes pixels — compare
them with someone else's decoder:

```python
from PIL import Image, ImageChops

with Image.open(original) as a, Image.open(stripped) as b:
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    assert diff.getbbox() is None, "pixels changed"
```

**Prevent.** Ask: *if my core implementation were wrong, would this assertion be
wrong in the same way?* If yes, it is not verification. Assertions about
"I did not damage the data" belong in another tool.

**Source.** Practice of this repository · verified (reproducible)

---

### 10. Fixtures must be read back and verified

**Symptom.** Tests are green and meaningless, because **the fixture does not
contain the data it claims to.**

**Why it hides.** Your assertion fails in a way that looks reasonable, so you go
and change the code under test instead of asking whether the fixture is empty.

**The example.**

```python
exif = Image.Exif()
exif[0x9003] = "2026:10:13 12:34:56"   # intending the Exif sub-IFD
image.save(path, "JPEG", exif=exif)
```

**That line does not raise, and the tag lands in IFD0 rather than the Exif
sub-IFD.** Every later test of "parses sub-IFD tags correctly" is then testing
nothing. The only way to find it is to read the file back immediately and
compare.

**Fix.** Have the fixture generator verify itself at the end and exit non-zero
when a field didn't stick.

**Prevent.** Make "generate fixtures + read back" a prerequisite step of the test
run rather than a one-off manual action. A fixture is the one thing you cannot
judge by whether it *looks* right — its correctness decides whether every test
that depends on it means anything.

**Source.** Practice of this repository · verified (reproducible)

---

## Contributing

Contributions welcome. **One rule: every entry needs a checkable source or
reproducible steps.** Unsourced experience is not included — not because it is
doubted, but because the entire value of this repository is that it can be
checked. See [CONTRIBUTING.md](CONTRIBUTING.md).

## How the checking works

`sources.json` lists each source with a URL and a phrase that **must still
appear on the page**. CI verifies both: the link resolves *and* the phrase is
there. When a vendor rewrites its docs, CI fails and the entry needs a human to
look again — **citations cannot rot quietly.**

```bash
node tools/check_sources.mjs
```

## License

Content under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
code snippets (CI config, scripts) under MIT. See [LICENSE](LICENSE).
