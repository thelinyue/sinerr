# Emby Playback Reporting 插件 fork（模块 3 改造）

> 上游：https://github.com/faush01/playback_reporting（请记住）
> 本地克隆：`D:\code\playback_reporting`
> 状态：**代码已改完**（本机 dotnet 不可用，未编译；在具备 .NET SDK 的机器上跑 `build.ps1`/`build.sh` 出 .dll）
> 边界原则：播放数据层走插件 API；媒体库层直连 Emby 原生（`DESIGN-sinerr-2.0.md` §5.1）

---

## 已实现的改动

### 1. PlaybackActivity 表新增 3 列（自动迁移）
`Data/ActivityRepository.cs` `InitializeInternal()` 的 `required_fields` 追加：
```csharp
required_fields.Add("SeriesId TEXT");
required_fields.Add("SeasonId TEXT");
required_fields.Add("ParentIndexNumber INT");
```
老库升级自动 `ALTER TABLE ADD`，不重建表。

### 2. 播放落库填充新列
- `Data/PlaybackInfo.cs`：`PlaybackInfo` 加 `SeriesId / SeasonId / ParentIndexNumber(int?)` 3 属性。
- `EventMonitorEntryPoint.cs` `GetPlaybackInfo()`：从 `session.NowPlayingItem` 填充：
```csharp
playback_info.SeriesId = session.NowPlayingItem.SeriesId;
playback_info.SeasonId = session.NowPlayingItem.SeasonId;
playback_info.ParentIndexNumber = session.NowPlayingItem.ParentIndexNumber;
```
- `Data/ActivityRepository.cs` `AddPlaybackAction()`：INSERT 带上 3 列（参数化绑定）。

### 3. 按季进度聚合 API
- `Data/ActivityRepository.cs`：`GetWatchedCountForSeason(userId, seriesId, seasonNumber)` ——
  `COUNT(DISTINCT ItemId) WHERE UserId=? AND SeriesId=? AND ParentIndexNumber=?`。
- `Api/UserActivityAPI.cs`：
  ```
  GET /user_usage_stats/series_progress/{seriesId}?userId=
  → { seriesId, seasons: [{ seasonNumber, total, watched }] }
  ```
  total 用 `_libraryManager.GetItemList` 本地实时算（无缓存过期），watched 走 `GetWatchedCountForSeason`。
  `[Authenticated(Roles = "admin")]`。

### 4. 中文翻译
- `Pages/helper_function.js`：新增 `PB_LANG` 字典 + `PB_T()` + `PB_applyI18n()`（MutationObserver 自动应用 `[data-i18n]`），`getTabs()` 标签名翻译。
- 各报表页 `<h2>`/表格头/设置页按钮加 `data-i18n` 属性（在线/播放/用户/汇总/明细/时段/已看/查询/设置 等）。

---

## 构建与部署

```powershell
# 在插件仓库目录
.\build.ps1          # Windows
./build.sh           # Linux/macOS
```
产物：`playback_reporting/bin/Release/netstandard2.0/playback_reporting.dll`
拷贝到 Emby 插件目录（如 `%AppData%\Emby-Server\programdata\plugins\`）重启 Emby。

## 验收（Emby 侧）
- [ ] 升级后 `PlaybackActivity` 表出现 3 新列（老库自动迁移）。
- [ ] 播放一集后该行带 `SeriesId / SeasonId / ParentIndexNumber`。
- [ ] `GET /user_usage_stats/series_progress/{seriesId}?userId=` 返回每季 `total + watched`。

## Sinerr 侧配套（已在本仓库实现）
- `server/api/jellyfin.ts` `getSeriesProgress`：调上述接口，404 返回 null 回退。
- `server/routes/user/index.ts` `/playback` 剧集分支：Episode 表本地季集结构 + 插件聚合，404 回退；响应新增 `seasons[]`。
- `src/components/TvDetails`：季行「已看 x/y / 已看完」进度徽标。

## 后续现代化方向（可选）
- Dapper 替代 SQLitePCL.pretty 手写绑定（ActivityRepository 体量大减）。
- `submit_custom_query` 任意 SQL 端点 → typed/只读白名单（安全加固收益最大）。
- DI 化 `ActivityRepository`（替换静态单例）、async 化。
