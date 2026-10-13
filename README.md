# ship-gotchas · 发开源项目时会踩的坑

> **你本地测不出来的那些。**
> 每一条都附来源，并且来源由 CI 自动校验——链接失效或官方文档改了口径，这个仓库的 CI 会红。

[English](README.en.md) · 简体中文

---

## 为什么会有这个仓库

本地测试全绿、lint 干净、构建产物也生成了——然后发布出去，在别人机器上第一次运行就坏掉。

这类坑的共同点是：**你的开发环境不缺任何东西，所以缺陷根本不显形**。你的 git 工作区里有全部文件、你的系统是大小写敏感的、你的 shell 是 bash。缺的那一项，恰好就是那个 bug 的触发条件。

下面每一条都写成同一个格式：

- **现象** — 你看到什么
- **为什么本地测不出来** — 触发条件在你机器上为什么不存在
- **怎么自查** — 一条能立刻跑的检查
- **怎么修** — 具体改动
- **怎么防止复发** — 一段能贴进 CI 的配置
- **来源** — 官方文档链接（CI 会校验它仍然有效）

---

## 目录

1. [sdist 里少了文件：默认只收 `tests/test*.py`](#1-sdist-里少了文件默认只收-teststestpy)
2. [MANIFEST.in 的命令顺序会决定结果](#2-manifestin-的命令顺序会决定结果)
3. [从 sdist 里跑一遍测试](#3-从-sdist-里跑一遍测试)
4. [只在 Windows 上崩的路径 bug](#4-只在-windows-上崩的路径-bug)
5. [PyPI 的 Owner 填的是 GitHub 账号，不是你的 PyPI 用户名](#5-pypi-的-owner-填的是-github-账号不是你的-pypi-用户名)
6. [pending publisher 不保留项目名](#6-pending-publisher-不保留项目名)
7. [PowerShell 把多行参数拆成了好几个](#7-powershell-把多行参数拆成了好几个)
8. [发版前必须核对 CI，不能只看本地](#8-发版前必须核对-ci不能只看本地)
9. [自指测试不算验证](#9-自指测试不算验证)
10. [测试夹具必须回读校验](#10-测试夹具必须回读校验)

---

## 1. sdist 里少了文件：默认只收 `tests/test*.py`

**现象**

从 sdist 装包后跑测试，直接倒在收集阶段：

```
ModuleNotFoundError: No module named 'support'
ERROR tests/test_walk.py
```

而你在仓库里跑同一套测试，全绿。

**为什么本地测不出来**

因为 sdist 里根本没有那个文件——而你手上的 git 工作区里什么都有。你的测试从来没跑在"缺文件"的那份代码上。

setuptools 官方文档列了默认进入 sdist 的文件，关于测试文件只有一条：

> Files that match the following glob patterns: `tests/test*.py`, `test/test*.py`

**只有 `tests/test*.py`。** 所以 `tests/support.py`、`tests/conftest.py`、任何 `tests/` 下的非 `test*.py` 文件，默认都不进 sdist。

**为什么这真的要紧**

不是"洁癖"。Homebrew、Debian、conda-forge 这些发行版**都是从 sdist 构建并运行测试套件**的。你的 sdist 缺文件，等于对这些下游全部坏掉，而你自己永远遇不到。

**怎么自查**

```bash
python -m build --sdist
tar tzf dist/*.tar.gz | sort > /tmp/in-sdist.txt
git ls-files | sed 's|^|你的包名-版本/|' | sort > /tmp/in-repo.txt
comm -23 /tmp/in-repo.txt /tmp/in-sdist.txt | head -30
```

**怎么修**

在项目根目录加 `MANIFEST.in`：

```
include CHANGELOG.md
include CONTRIBUTING.md

recursive-include tests *
recursive-include examples *
```

**怎么防止复发**

CI 里加一个 job，解包 sdist 再跑测试——这是唯一能在本地之外发现它的办法：

```yaml
  sdist:
    name: sdist 是否自足
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: |
          python -m pip install --upgrade build pytest
          python -m build --sdist
      - run: |
          mkdir -p /tmp/from-sdist
          tar xzf dist/*.tar.gz -C /tmp/from-sdist
          cd /tmp/from-sdist/*/
          python -m pytest -q
```

**来源**：[setuptools — Controlling files in the distribution](https://setuptools.pypa.io/en/latest/userguide/miscellaneous.html) · 已核实

---

## 2. MANIFEST.in 的命令顺序会决定结果

**现象**

你加了 `recursive-include examples *`，sdist 变大了——里面还混进了 `examples/__pycache__/*.pyc`。

**为什么本地测不出来**

因为**只有你本地跑过示例脚本、留下过字节码缓存时才会发生**。CI 从全新 checkout 构建，没有 `__pycache__`，所以 CI 干净、你本地脏，而没人会去比较这两者。

**怎么自查**

对比"已发布的 sdist"和"你本地构建的 sdist"的文件清单——这是唯一能看见差异的角度：

```bash
pip download 你的包 --no-deps --no-binary :all: -d /tmp/published
tar tzf /tmp/published/*.tar.gz | sort > /tmp/a.txt
tar tzf dist/*.tar.gz | sort > /tmp/b.txt
diff /tmp/a.txt /tmp/b.txt
```

**怎么修**

setuptools 文档专门解释了顺序的影响，并给出示例：

```
graft tests
global-exclude *.py[cod]
```

> the contents of the directory tree `tests` will first be added to the sdist, and then after that all files with a `.pyc`, `.pyo`, or `.pyd` extension will be removed. **If the commands were in the opposite order**, then `*.pyc` files would only be removed from what was already in the sdist before adding `tests`.

也就是：**`global-exclude` 必须排在所有 `include`/`graft` 之后**。

**怎么防止复发**

CI 里加一句断言，别让字节码进 sdist：

```yaml
      - run: |
          if tar tzf dist/*.tar.gz | grep -qE '\.pyc$|__pycache__'; then
            echo "::error::sdist 里混进了字节码"
            exit 1
          fi
```

**来源**：[setuptools — Controlling files in the distribution](https://setuptools.pypa.io/en/latest/userguide/miscellaneous.html) · 已核实

---

## 3. 从 sdist 里跑一遍测试

**现象**

没有现象。这就是问题所在——它是第 1 条能成立的前提。

**为什么本地测不出来**

`pip install -e .` 装的是你的工作区，不是 sdist。你测的从来不是发布出去的那份东西。

**怎么自查 / 怎么修 / 怎么防止复发**

见第 1 条的 CI 配置：**构建 sdist → 解包到临时目录 → 在解包目录里跑测试**。三步都要，缺一步就退化成"测工作区"。

**为什么值得单独列一条**

因为它的价值不在这次，而在下次。第 1 条修好之后，没有任何东西阻止第二个人再往 `tests/` 里放一个非 `test*.py` 的文件。

**来源**：本条为本仓库实践，见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml) · 已核实（可复现）

---

## 4. 只在 Windows 上崩的路径 bug

**现象**

Linux 和 macOS 全绿，Windows 上：

```
AssertionError: False is not true
AssertionError: Items in the second set but not the first: 'src/a.py'
```

**为什么本地测不出来**

因为触发条件在 POSIX 上**物理不可能存在**。真实代码是：

```python
def is_inside(root, repo):
    real_root = os.path.realpath(root)
    return real_root == repo or real_root.startswith(os.path.join(repo, ""))
```

问题在于：一侧做了 `realpath`，另一侧没有。在 POSIX 上 `realpath("/repo")` 恰好仍然等于 `"/repo"`，两边一致，函数看起来完全正确。在 Windows 上 `realpath("/repo")` 是 `D:\repo`，于是永远不相等。

**你的测试写得多也不管用**——这是环境差异，不是覆盖率问题。

**怎么自查**

不要只挑一条路径测。让"解析后的路径"和"传入的路径"不相等，然后看函数还对不对：

```python
def test_path_normalisation(self):
    real = os.path.realpath(tmp)
    link = os.path.join(real, "link")
    os.symlink(real, link, target_is_directory=True)   # 让 realpath(x) != x
    self.assertTrue(is_inside(os.path.join(link, "sub"), link))
```

**这一招是整个条目里最值钱的部分**：它把"只在 Windows 暴露"这个条件**搬到了 Linux 上**，于是本地就能拦住，不用等 Windows runner 跑完再去翻日志。

**怎么修**

两侧都归一化，并且用 `normcase` 处理 Windows 的盘符大小写和分隔符：

```python
def normalise(path: str) -> str:
    return os.path.normcase(os.path.realpath(path))
```

**怎么防止复发**

矩阵里必须有 Windows，而且**发版前必须真的去看它**（见第 8 条）：

```yaml
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
```

**来源**：[Python — `os.path.normcase`](https://docs.python.org/3/library/os.path.html) · 已核实（本仓库用 symlink 复现过，对旧代码确实失败）

---

## 5. PyPI 的 Owner 填的是 GitHub 账号，不是你的 PyPI 用户名

**现象**

trusted publisher 配好了，发布时 OIDC 交换失败。**错误信息不会告诉你字段填错了。**

**为什么容易搞错**

表单里那栏就叫 "Owner"，很容易理解成"我自己的用户名"。实际上它问的是**拥有仓库的 GitHub 账号或组织**。PyPI 的文档给的例子是：

> If you have a repository at `https://github.com/octo-org/sampleproject` …

——`octo-org` 才是那一栏该填的。

**你的 PyPI 用户名根本不需要出现在这个表单里**，因为 publisher 本来就挂在你登录的 PyPI 账号下，这正是 "pending" 的意思。

**怎么自查**

看清楚你填出来的那串是不是一个**真实存在**的 GitHub 仓库地址。填错时你会得到一个指向不存在的 `你的PyPI用户名/仓库名` 的配置。

**怎么修**

| 字段 | 该填什么 |
| --- | --- |
| PyPI Project Name | 项目名，纯 ASCII |
| **Owner** | **GitHub 账号或组织名** |
| Repository name | 仓库名本身，**不要**写成 `owner/repo` |
| Workflow name | 工作流**文件名**（`release.yml`），不是 `name:` 字段的值 |
| Environment name | 工作流里 `environment.name` 的值 |

**来源**：[PyPI Docs — Creating a project with a Trusted Publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/) · 已核实

---

## 6. pending publisher 不保留项目名

**现象**

你以为配完 pending publisher 名字就锁住了。没有。

**为什么会这么以为**

"pending" 听起来像"已占位"。而文档说的是反的：

> A "pending" publisher **does not** create a project or reserve a project's name **until** it is actually used to publish. If you create a "pending" publisher but another user registers the project name before you actually publish to it, your "pending" publisher will be **invalidated**.

**怎么自查 / 怎么修**

名字是**第一次成功发布**那一刻才占住的。所以配好之后应当尽快发布，而不是"慢慢来"。

另外两件相关的事，都值得在起名阶段做：

- **查名字是否已被占用**（用 API，不要看网页）：`https://pypi.org/pypi/你的项目名/json` 返回 404 才是可用。
- **同时查相近名字**。PyPI 在上传那一刻会做相似度检查，`packctx` 与已占用的 `ctxpack` 只差一个换位，很可能被直接拒。查一下邻近的几个名字，比上传时被拒划算。

**来源**：[PyPI Docs — Creating a project with a Trusted Publisher](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/) · 已核实

---

## 7. PowerShell 把多行参数拆成了好几个

**现象**

在 Windows PowerShell 里把一段多行文本作为参数传给命令行程序：

```
accepts 1 arg(s), received 3
```

命令本身没错，值也没错。

**为什么容易搞错**

在 bash 里这不会发生。而 PowerShell 把命令交给原生程序的方式是：**把参数拼成一个命令行字符串再交出去**——官方文档原文：

> 从 PowerShell 运行本机命令时，参数首先由 PowerShell 分析。然后，分析的参数将联接到单个字符串中，每个参数用空格分隔。

含空白（空格、换行）的值在这种拼接里的引号处理依赖版本与 `$PSNativeCommandArgumentPassing` 模式，于是会出现"一个参数到对面变成了三个"。

**怎么修**

**别跟引号较劲，改走标准输入。** 这条路完全绕开参数拼接：

```bash
git tag -l --format="%(contents)" v1.0.0 | gh release edit v1.0.0 --notes-file -
```

`--notes-file -` 里的 `-` 表示从 stdin 读。管道传的是字节流，不经过参数解析。

**顺带一条同类经验**：`<占位符>` 不要原样复制进 PowerShell。`<` 在 PowerShell 里是保留运算符，报的是 `RedirectionNotSupported`——那个错误跟你的命令无关，会把人带偏。

**来源**：[Microsoft Learn — about_Parsing](https://learn.microsoft.com/zh-cn/powershell/module/microsoft.powershell.core/about/about_parsing) · 已核实

---

## 8. 发版前必须核对 CI，不能只看本地

**现象**

本地 152 个测试全绿、lint 干净、`twine check` 通过、wheel 装得上、跑得对。**然后 CI 是红的。**

**为什么这是独立的一条**

因为前面七条都可能被你躲过去，而这一条是最后一道闸。我自己的记录：本地一切正常，CI 上 Windows 那个 job 挂在 `Run tests`，原因就是第 4 条。如果不看 CI 直接发版，坏版本就钉在 release 上了。

**怎么自查**

```bash
gh run list --limit 5
```

看 `CONCLUSION` 那一列。**注意看结论，别看颜色心情。**

**怎么修 / 怎么防止复发**

- 发 tag 之前，确认当前提交的 CI 是绿的。
- 红的时候取日志，别自己贴一大段：

```bash
gh run view --log-failed | Out-File -Encoding utf8 ci-failure.txt
```

匿名调用 GitHub API 读 Actions 日志会拿到 403，所以走 `gh`（已登录）。

- 想确认某个 job 真的跑了、而不是被跳过：

```bash
gh run view <run-id>        # 列出所有 job 及各自结论
```

**来源**：本条为本仓库实践 · 已核实（可复现）

---

## 9. 自指测试不算验证

**现象**

测试全绿，但你其实什么都没验证——因为**断言和实现在犯同一个错误**。

**为什么本地测不出来**

这一类不是环境差异，而是**推理结构的缺陷**。它比前面几条更隐蔽，因为测试数量越多，你越容易相信"测过了"。

**具体例子**

做"清除元数据但不改变图像"这个功能时，最自然的测试是这样：

```js
// ✗ 自己验自己
const before = readSegments(photo);
const after = readSegments(stripped);
assert.deepEqual(strippedScan(after), originalScan(before));
```

如果 `readSegments`（我自己写的容器遍历）算错了扫描数据的起点，那么"取出来"和"取出来比较"会**一起错**，断言照样通过。测试覆盖的是我的实现和它自己的一致性。

**怎么修**

把验证放到**另一个实现**里。JPEG 是有损格式，所以只要清除时误重编码、或丢了量化表/哈夫曼表，像素必然不同——用别人的解码器比对像素，就不依赖我自己的解析器：

```python
from PIL import Image, ImageChops

with Image.open(original) as a, Image.open(stripped) as b:
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    assert diff.getbbox() is None, "像素改变了"
    assert not Image.open(stripped).getexif(), "元数据没清干净"
```

**怎么防止复发**

问自己一句话：**"如果我的核心实现写错了，这个断言会跟着一起错吗？"** 会的话，它就不是验证。

适用于这类主张的断言，必须来自另一个工具、另一份实现、或独立的规格。

**来源**：本条为本仓库实践 · 已核实（可复现，见"清除后像素零差异"的验证脚本思路）

---

## 10. 测试夹具必须回读校验

**现象**

测试全过，而且毫无意义——**因为夹具里根本没有它声称的数据**。

**为什么本地测不出来**

因为你的断言读不到数据时，往往"失败得很有道理"：你没有去查"夹具是不是空的"，而是去改被测代码。

**具体例子**

用 Pillow 生成带 EXIF 的测试图片，直觉会这样写：

```python
exif = Image.Exif()
exif[0x9003] = "2026:10:13 12:34:56"   # 想写进 Exif 子 IFD
image.save(path, "JPEG", exif=exif)
```

**这行代码不会报错，但标签落进了 IFD0，不在 Exif 子 IFD。** 于是后面所有"能正确解析子 IFD 标签"的测试，测的都是空气。

真正发现它的方式只有一个：**写完立刻读回来比对**。

**怎么修**

让生成夹具的脚本在结尾自己校验一遍，不合格就退出非零：

```python
def verify(paths):
    problems = []
    with Image.open(paths["jpeg"]) as image:
        sub = image.getexif().get_ifd(0x8769)
        if sub.get(0x9003) != EXPECTED["datetime"]:
            problems.append(f"ExifIFD DateTimeOriginal: {sub.get(0x9003)!r}")
    return problems
```

**怎么防止复发**

把"生成夹具 + 回读校验"当成测试的前置步骤，而不是一次性手工动作。

一条原则：**夹具是你唯一不能靠"它看起来对"来判断的东西。** 它的正确性决定了所有依赖它的测试是否有意义。

**来源**：本条为本仓库实践 · 已核实（可复现）

---

## 贡献

欢迎补充。**标准只有一条：每条必须有可校验的来源，或可复现的步骤。** 没有来源的经验不收录——不是因为不信你，是因为这个仓库的全部价值在于"可以核对"。

格式、校验方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 校验机制

`sources.json` 列出每个来源的 URL 和一段**必须仍然存在于页面上**的关键短语。

CI 会逐条检查：链接可达 **且** 短语仍在。官方文档一旦改口径，CI 变红，对应的条目需要重新核实——**引用不会悄悄过期**。

```bash
node tools/check_sources.mjs      # 本地跑同一套检查
```

## 许可

内容采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh)，
其中的代码片段（CI 配置、脚本）采用 MIT，可直接取用。
