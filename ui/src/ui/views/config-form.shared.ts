import type { ConfigUiHints } from "../types";

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: JsonSchema | boolean;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
};

export function schemaType(schema: JsonSchema): string | undefined {
  if (!schema) return undefined;
  if (Array.isArray(schema.type)) {
    const filtered = schema.type.filter((t) => t !== "null");
    return filtered[0] ?? schema.type[0];
  }
  return schema.type;
}

export function defaultValue(schema?: JsonSchema): unknown {
  if (!schema) return "";
  if (schema.default !== undefined) return schema.default;
  const type = schemaType(schema);
  switch (type) {
    case "object":
      return {};
    case "array":
      return [];
    case "boolean":
      return false;
    case "number":
    case "integer":
      return 0;
    case "string":
      return "";
    default:
      return "";
  }
}

export function pathKey(path: Array<string | number>): string {
  return path.filter((segment) => typeof segment === "string").join(".");
}

export function hintForPath(path: Array<string | number>, hints: ConfigUiHints) {
  const key = pathKey(path);
  const direct = hints[key];
  if (direct) return direct;
  const segments = key.split(".");
  for (const [hintKey, hint] of Object.entries(hints)) {
    if (!hintKey.includes("*")) continue;
    const hintSegments = hintKey.split(".");
    if (hintSegments.length !== segments.length) continue;
    let match = true;
    for (let i = 0; i < segments.length; i += 1) {
      if (hintSegments[i] !== "*" && hintSegments[i] !== segments[i]) {
        match = false;
        break;
      }
    }
    if (match) return hint;
  }
  return undefined;
}

// Common field name translations
const FIELD_TRANSLATIONS: Record<string, string> = {
  "Preserve Filenames": "保留文件名",
  "Enable": "启用",
  "Enabled": "已启用",
  "Disabled": "已禁用",
  "Name": "名称",
  "Description": "描述",
  "Type": "类型",
  "Value": "值",
  "Default": "默认值",
  "Required": "必填",
  "Optional": "可选",
  "Path": "路径",
  "Url": "URL",
  "Host": "主机",
  "Port": "端口",
  "Timeout": "超时",
  "Retry": "重试",
  "Max": "最大值",
  "Min": "最小值",
  "Limit": "限制",
  "Count": "数量",
  "Size": "大小",
  "Duration": "时长",
  "Interval": "间隔",
  "Delay": "延迟",
  "Format": "格式",
  "Prefix": "前缀",
  "Suffix": "后缀",
  "Key": "密钥",
  "Token": "令牌",
  "Secret": "密钥",
  "Username": "用户名",
  "Password": "密码",
  "Email": "邮箱",
  "Phone": "电话",
  "Address": "地址",
  "Level": "级别",
  "Mode": "模式",
  "Status": "状态",
  "State": "状态",
  "Version": "版本",
  "Id": "ID",
  "Filename": "文件名",
  "File": "文件",
  "Folder": "文件夹",
  "Directory": "目录",
  "Output": "输出",
  "Input": "输入",
  "Source": "来源",
  "Target": "目标",
  "Destination": "目的地",
  "Language": "语言",
  "Locale": "区域",
  "Timezone": "时区",
  "Date": "日期",
  "Time": "时间",
  "Timestamp": "时间戳",
  "Created": "创建时间",
  "Updated": "更新时间",
  "Deleted": "删除时间",
  "Active": "活跃",
  "Inactive": "不活跃",
  "Running": "运行中",
  "Stopped": "已停止",
  "Pending": "待处理",
  "Completed": "已完成",
  "Failed": "失败",
  "Success": "成功",
  "Error": "错误",
  "Warning": "警告",
  "Info": "信息",
  "Debug": "调试",
  "Trace": "跟踪",
  "Config": "配置",
  "Settings": "设置",
  "Options": "选项",
  "Parameters": "参数",
  "Properties": "属性",
  "Attributes": "属性",
  "Metadata": "元数据",
  "Headers": "头信息",
  "Body": "正文",
  "Content": "内容",
  "Message": "消息",
  "Title": "标题",
  "Label": "标签",
  "Text": "文本",
  "Image": "图片",
  "Video": "视频",
  "Audio": "音频",
  "Document": "文档",
  "Attachment": "附件",
  "Upload": "上传",
  "Download": "下载",
  "Import": "导入",
  "Export": "导出",
  "Sync": "同步",
  "Backup": "备份",
  "Restore": "恢复",
  "Reset": "重置",
  "Clear": "清除",
  "Delete": "删除",
  "Remove": "移除",
  "Add": "添加",
  "Create": "创建",
  "Edit": "编辑",
  "Update": "更新",
  "Save": "保存",
  "Cancel": "取消",
  "Close": "关闭",
  "Open": "打开",
  "View": "查看",
  "Show": "显示",
  "Hide": "隐藏",
  "Expand": "展开",
  "Collapse": "收起",
  "Filter": "筛选",
  "Search": "搜索",
  "Sort": "排序",
  "Group": "分组",
  "Select": "选择",
  "All": "全部",
  "None": "无",
  "Yes": "是",
  "No": "否",
  "True": "是",
  "False": "否",
  "On": "开",
  "Off": "关",
  "Auto": "自动",
  "Manual": "手动",
  "Custom": "自定义",
  "System": "系统",
  "User": "用户",
  "Admin": "管理员",
  "Guest": "访客",
  "Public": "公开",
  "Private": "私有",
  "Internal": "内部",
  "External": "外部",
  "Local": "本地",
  "Remote": "远程",
  "Global": "全局",
  "Regional": "区域",
};

export function humanize(raw: string) {
  // First apply standard humanize
  const humanized = raw
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (m) => m.toUpperCase());
  
  // Then check for translation
  return FIELD_TRANSLATIONS[humanized] ?? humanized;
}

export function isSensitivePath(path: Array<string | number>): boolean {
  const key = pathKey(path).toLowerCase();
  return (
    key.includes("token") ||
    key.includes("password") ||
    key.includes("secret") ||
    key.includes("apikey") ||
    key.endsWith("key")
  );
}
