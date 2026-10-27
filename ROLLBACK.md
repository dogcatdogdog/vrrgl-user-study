# 回滚点：Pilot v1（2026-10-27）

在移除 T4 / 修改 T1 之前建立的稳定快照。任何改动出问题，按下面步骤回到这一刻。

## 快照身份

| 项目 | 值 |
|---|---|
| Git tag | `pilot-v1-20261027` |
| Git 分支 | `stable/pilot-v1` |
| Commit | `d7c9c2d`（Fix attention check false negative on full-width input） |
| 协议 | 三任务（T1/T4/T2），48 trial，5 练习，2 注意力检查 |
| 数据 | `data/sealed/2026-10-27_pilot_v1/`（只读，6 份） |

## 一、本地代码回滚

### 方式 A：新开一个分支（推荐，不破坏 main）

```powershell
cd D:\VRRGL\user_study_app
git switch -c rollback/pilot-v1 pilot-v1-20261027
```

确认没问题后，再决定是否把它合并回 main。

### 方式 B：让 main 回到快照（会丢弃当前未提交改动）

```powershell
cd D:\VRRGL\user_study_app
git status                 # 先确认没有要保留的改动
git switch main
git reset --hard pilot-v1-20261027
```

## 二、线上（GitHub Pages）回滚

线上由 `main` 分支自动部署。推荐**用一次回滚提交**而不是 force push：

```powershell
cd D:\VRRGL\user_study_app
git switch main
git checkout pilot-v1-20261027 -- .
git commit -m "Rollback to pilot-v1-20261027"
git push
```

等 GitHub Pages 重新构建（约 20 秒），用 `curl` 检查：

```powershell
curl -s https://dogcatdogdog.github.io/vrrgl-user-study/src/js/config.js |
  findstr "T4: { enabled"
```

应看到 `T4: { enabled: true }`。

## 三、数据回滚 / 隔离

- 旧 pilot 数据已移出 `data/`，封存在 `data/sealed/2026-10-27_pilot_v1/`，并设为只读。
- `manifest.json` 记录了每份文件的 SHA-256、被试信息、配置快照与已知问题。
- **新版协议收集的数据不得与封存数据合并**；需要对照时，明确标注为不同协议、不同样本。
- 如果误删，可从 `pilot_v1_data.zip` 解压恢复，并用 `manifest.json` 校验：

```powershell
Get-FileHash data\sealed\2026-10-27_pilot_v1\P8B73.json -Algorithm SHA256
```

## 四、验证快照完整性

```powershell
cd D:\VRRGL\user_study_app
git rev-parse pilot-v1-20261027      # 应为 d7c9c2d...
git diff --stat pilot-v1-20261027 main
```

`git diff` 为空表示 main 与快照一致。

## 五、网络说明

本机 Git 的仓库级代理设置为 `socks5h://127.0.0.1:10808`（代理未开时推送会失败）。
代理不可用时，可临时直连：

```powershell
git -c http.proxy= -c https.proxy= push
```

## 六、改版后的预期

改版（移除 T4、调整 T1）会让：

- 试次从 48 → 32（T1 16 + T2 16），练习从 5 → 3；
- 知情同意书、README、欢迎页的时长与题量文案需要同步；
- 旧 pilot 的 6 人**不进入**新版主分析，只作为 pilot 证据。

详见 `data/sealed/2026-10-27_pilot_v1/README.md`。
