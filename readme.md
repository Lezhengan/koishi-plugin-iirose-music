# koishi-plugin-iirose-music

基于 ShadowSee API 的蔷薇花园(IIROSE)点歌插件，由 [XCWQW1/iirose_music](https://github.com/XCWQW1/iirose_music) 的 `iirose_music.py`（部署在 iirosebot 框架中时位于 `iirosebot-1.6.1/plugins/iirose_music.py`）移植而来。

原作者 [XCWQW1](https://github.com/XCWQW1)（站内昵称 xcwqw233），原作品以 Apache-2.0 授权发布，来源与改动说明见 [NOTICE](https://github.com/Lezhengan/koishi-plugin-iirose-music/blob/main/NOTICE)。

## 功能

- 点歌 / 点歌id（支持 VIP 歌曲，需配置 Cookie）
- 歌单 / 专辑 / 电台 / 歌手 搜索与 id 添加
- 队列自动播放（顺序/随机/循环）
- 跳过 / 清空 / 列表管理
- 网易云热评自动发送（`<TT1` 开关），热评随机抽取数量可配置（3-20）
- 支持同一个 Koishi 挂多个 iirose adapter：各房间的队列/播放模式各自独立，互不干扰

## 多机器人（多 adapter）

同一个 Koishi 里可以挂多个 IIROSE 账号（各自待在不同房间）。为了不互相打架：

- 队列、播放模式（顺序/随机/循环）、跳过标记都按机器人分开，`>列表` / `>清空` / `>跳过` 只影响当前房间。
- 默认由「接收这条消息的那个机器人」播放。
- 典型场景：同一个房间里挂了多个机器人账号，想指定其中一个负责点歌 —— 用配置项 `botTable` 填一行，`机器人ID` 填该机器人的 selfId，`房间ID` 填房间号，即以表为准。
- 注意：IIROSE 的媒体是由机器人自己的连接发出去的，只能播进它自己所在的房间，**无法**「在 A 房间发指令、让 B 房间的机器人播放」。

## 依赖

- [koishi](https://koishi.chat/) ^4.18.8
- [koishi-plugin-adapter-iirose](https://github.com/iirose-plugins/koishi-plugin-adapter-iirose) ^0.12.11

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| apiBase | `https://api.shadowsee.icu` | ShadowSee API 基地址 |
| quality | `standard` | 默认音质（standard/higher/exhigh/lossless/hires/sky/jyeffect/jymaster） |
| cookie | 空 | 网易云 Cookie，用于播放 VIP 歌曲（可选） |
| commandHead | `>` | 指令前缀 |
| musicHot | `true` | 是否自动发送网易云热评 |
| hotCommentLimit | `3` | 热评随机抽取数量，可选 3-20；请求返回该数量的热评后随机发一条 |
| botTable | 空 | 播放归属表：一行表示「房间ID 的指令由 机器人ID 播放」。单个 Koishi 里挂了多个 iirose adapter 时用；留空则自动使用接收消息的那个机器人 |

## 指令

```
>点歌 (歌名)          - 搜索网易云歌曲，可解析VIP歌曲
>点歌id (歌曲id)      - 按id播放网易云歌曲
>列表                - 查看在列表中的歌
>列表 删除 (名)       - 删除列表中指定来源的歌曲
>跳过                - 跳过当前机器人播放的歌曲
>跳过 列表            - 跳过当前队列中的歌曲
>清空                - 清空队列中的所有歌曲
>歌单 搜索 (歌单名)    - 搜索网易云歌单
>歌单 id (歌单id)     - 用歌单id播放歌单
>专辑 搜索 (专辑名)    - 搜索网易云专辑
>专辑 id (专辑id)     - 用专辑id播放专辑
>电台 搜索 (电台名)    - 搜索网易云电台
>电台 id (电台id)     - 用电台id播放电台
>歌手 搜索 (歌手名)    - 搜索网易云歌手
>歌手 id (歌手id)     - 用歌手id播放歌手所有歌曲
>模式                - 查询当前模式状态
>模式 列表/循环        - 更改 列表/循环 的状态
<TT1                 - 切换热评发送开关
```

## 许可

本项目以 MIT 许可证发布，见 [LICENSE](https://github.com/Lezhengan/koishi-plugin-iirose-music/blob/main/LICENSE)。

它是 [XCWQW1/iirose_music](https://github.com/XCWQW1/iirose_music)（Apache-2.0）的移植衍生作品，来源与改动说明见 [NOTICE](https://github.com/Lezhengan/koishi-plugin-iirose-music/blob/main/NOTICE)，原作品许可证副本见 [LICENSE-APACHE](https://github.com/Lezhengan/koishi-plugin-iirose-music/blob/main/LICENSE-APACHE)。
