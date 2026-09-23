# koishi-plugin-iirose-music

基于 ShadowSee API 的蔷薇花园(IIROSE)点歌插件，由 [XCWQW1/iirose_music](https://github.com/XCWQW1/iirose_music) 的 `iirose_music.py`（部署在 iirosebot 框架中时位于 `iirosebot-1.6.1/plugins/iirose_music.py`）移植而来。

原作者 [XCWQW1](https://github.com/XCWQW1)（站内昵称 xcwqw233），原作品以 Apache-2.0 授权发布，来源与改动说明见 [NOTICE](https://github.com/Lezhengan/koishi-plugin-iirose-music/blob/main/NOTICE)。

## 功能

- 点歌 / 点歌id（支持 VIP 歌曲，需配置 Cookie）
- 歌单 / 专辑 / 电台 / 歌手 搜索与 id 添加
- 队列自动播放（顺序/随机/循环）
- 跳过 / 清空 / 列表管理
- 网易云热评自动发送（`<TT1` 开关），热评随机抽取数量可配置（3-20）

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
