export interface MessageCatalog {
  t(key: string, params?: Record<string, string>, locale?: string): string;
}

type Messages = Record<string, string>;

const DEFAULT_LOCALE = 'zh-TW';

export class JsonMessageCatalog implements MessageCatalog {
  private readonly catalogs = new Map<string, Messages>();

  constructor(catalogs: Record<string, Messages>) {
    for (const [locale, messages] of Object.entries(catalogs)) {
      this.catalogs.set(locale, messages);
    }
  }

  t(key: string, params?: Record<string, string>, locale?: string): string {
    const resolvedLocale = locale ?? DEFAULT_LOCALE;
    const messages = this.catalogs.get(resolvedLocale) ?? this.catalogs.get(DEFAULT_LOCALE);

    if (!messages) {
      return key;
    }

    const template = messages[key];
    if (!template) {
      const fallback = this.catalogs.get(DEFAULT_LOCALE);
      const fallbackTemplate = fallback?.[key];
      if (!fallbackTemplate) return key;
      return this.interpolate(fallbackTemplate, params);
    }

    return this.interpolate(template, params);
  }

  private interpolate(template: string, params?: Record<string, string>): string {
    if (!params) return template;

    return template.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) => {
      return params[paramKey] ?? `{{${paramKey}}}`;
    });
  }
}

export function loadDefaultCatalog(): MessageCatalog {
  // Lazy-load JSON messages
  const zhTW: Messages = {
    'welcome.message': '歡迎加入！請點選下方選單開始綁定您的員工身份。',
    'welcome.title': '歡迎使用 ONE TEAM',
    'binding.instruction': '請輸入您的員工編號和綁定碼完成綁定。',
    'binding.success': '綁定成功！您現在可以使用員工服務了。',
    'access.pending': '您的存取申請正在審核中，請耐心等候。',
    'access.approved': '您的存取申請已通過！',
    'access.rejected': '您的存取申請未通過，如有疑問請聯絡管理員。',
    'offboarding.notification': '您的帳號已被管理員離職處理。',
    'postback.received': '已收到您的操作。',
    'error.generic': '系統發生錯誤，請稍後再試。',
    'error.rate_limited': '請求過於頻繁，請稍後再試。',
    'email.invitation.subject': '{{tenantName}} — ONE TEAM 員工綁定邀請',
    'email.invitation.greeting': '您好，{{employeeId}}'
  };

  const en: Messages = {
    'welcome.message': 'Welcome! Please tap the menu below to start binding your employee identity.',
    'welcome.title': 'Welcome to ONE TEAM',
    'binding.instruction': 'Please enter your employee ID and binding code to complete the process.',
    'binding.success': 'Binding successful! You can now use employee services.',
    'access.pending': 'Your access request is under review. Please wait.',
    'access.approved': 'Your access request has been approved!',
    'access.rejected': 'Your access request was rejected. Contact your administrator for details.',
    'offboarding.notification': 'Your account has been offboarded by an administrator.',
    'postback.received': 'Your action has been received.',
    'error.generic': 'A system error occurred. Please try again later.',
    'error.rate_limited': 'Too many requests. Please try again later.',
    'email.invitation.subject': '{{tenantName}} — ONE TEAM Employee Binding Invitation',
    'email.invitation.greeting': 'Hello, {{employeeId}}'
  };

  return new JsonMessageCatalog({ 'zh-TW': zhTW, en });
}
