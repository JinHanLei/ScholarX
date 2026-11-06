# Idea 论文模型图格式

Codex 直接在 `document.figure` 中编写矢量图，按真实研究方法安排分组、分支、数据流、
关键符号和图注。页面只负责展示，不把所有方法硬套成相同大小的流程卡片。
`document.graph` 继续保存模块语义与稳定 ID，供版本差异和实验实现使用。
改变方法时同时更新 graph 和 figure；仅调整图形表现时保留 graph 原样。

```json
{
  "width": 900,
  "height": 360,
  "title": "Method overview",
  "caption": "根据真实方法编写的图注，明确候选设计与已验证结果的边界。",
  "elements": [
    {"id":"encoder","type":"rect","x":100,"y":90,"width":220,"height":90,"radius":5,"fill":"#eef4fa","stroke":"#64748b"},
    {"id":"encoder-label","type":"text","x":115,"y":116,"width":190,"height":35,"text":"Temporal encoder","fontSize":20,"bold":true},
    {"id":"flow","type":"polyline","points":[[320,135],[390,135],[390,220],[450,220]],"arrowEnd":true,"stroke":"#475569","strokeWidth":2},
    {"id":"output","type":"ellipse","x":450,"y":180,"width":80,"height":80,"fill":"#ffffff","stroke":"#64748b"},
    {"id":"sum","type":"text","x":450,"y":201,"width":80,"height":35,"text":"+","fontSize":25,"align":"center"}
  ]
}
```

| 字段 | 约束 / 用途 |
| --- | --- |
| `width`, `height` | 画幅大小，100–4000；建议 900–1200 宽，按内容确定高度 |
| `title`, `caption` | 普通文本；标题不超过 300 字符，图注不超过 5000 字符 |
| `elements` | 1–1000 个元素，按绘制顺序；先背景分组，再箭头、模块、文字 |
| `id` | 稳定、唯一的英文/数字/连字符/下划线 ID，最长 100 字符 |
| `type` | `rect`、`ellipse`、`text`、`line`、`polyline` |
| `x`, `y`, `width`, `height` | 矩形、椭圆、文本的边界框，必须位于画幅内 |
| `points` | 折线坐标数组；line 恰好两个点，polyline 最多 500 点 |
| `fill`, `stroke`, `color` | `#RRGGBB` 或 `none`；color 是文字颜色 |
| `strokeWidth`, `dash`, `arrowEnd` | 线宽 0–12、虚线、末端箭头；折线使用 fill:none |
| `radius` | 矩形圆角，0–50 |
| `text`, `fontSize`, `bold`, `align` | 普通文字，支持换行与 Unicode 符号；字号 8–80，align 为 left/center/right |
| `node_id` | 可选，对应语义 graph 中的稳定模块 ID |
| `source_hash` | 服务端生成的图与结构关联标记；原样沿用旧图时保留，不手工伪造 |

不要嵌入 HTML、脚本、外部图片或 URL。曲线可用多段折线表达；图中文字不会被作为
HTML 执行。该格式不直接排版 LaTeX，复杂公式可在可编辑 PPT 中进一步排版。

绘图检查：字体在论文缩放后可读；重要箭头方向明确；分支不是装饰；分组有科学含义；
图注不把尚未运行的候选方法写成已验证结论。概念曲线必须明确是示意，不能冒充指标。

SVG 和 PPT 使用同一份坐标、文字与元素。PPT 中保留原生文本、形状和分段线；外部
PPT 修改不会自动回传。所有正式版本与讨论记录保留各自的 figure 快照。
