export interface InvitationEmailData {
  tenantName: string;
  employeeId: string;
  inviteUrl: string;
  bindingCode: string;
  expiresAt: string;
}

export function renderInvitationEmailHtml(data: InvitationEmailData): string {
  const escapedTenantName = escapeHtml(data.tenantName);
  const escapedEmployeeId = escapeHtml(data.employeeId);
  const escapedInviteUrl = escapeHtml(data.inviteUrl);
  const escapedBindingCode = escapeHtml(data.bindingCode);
  const escapedExpiresAt = escapeHtml(data.expiresAt);

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">您好，${escapedEmployeeId}</h2>
  <p>${escapedTenantName} 邀請您加入 ONE TEAM 員工平台。</p>
  <p>請點擊下方連結完成綁定：</p>
  <p><a href="${escapedInviteUrl}" style="display: inline-block; padding: 12px 24px; background-color: #06C755; color: #fff; text-decoration: none; border-radius: 6px;">開始綁定</a></p>
  <p>您的綁定碼：<strong style="font-size: 1.2em; letter-spacing: 2px;">${escapedBindingCode}</strong></p>
  <p style="color: #666; font-size: 0.9em;">此連結將於 ${escapedExpiresAt} 到期。</p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
  <p style="color: #999; font-size: 0.8em;">此為系統自動發送的郵件，請勿直接回覆。</p>
</body>
</html>`;
}

export function renderInvitationEmailText(data: InvitationEmailData): string {
  return `您好，${data.employeeId}

${data.tenantName} 邀請您加入 ONE TEAM 員工平台。

請開啟以下連結完成綁定：
${data.inviteUrl}

您的綁定碼：${data.bindingCode}

此連結將於 ${data.expiresAt} 到期。

此為系統自動發送的郵件，請勿直接回覆。`;
}

export function renderInvitationEmailSubject(tenantName: string): string {
  return `${tenantName} — ONE TEAM 員工綁定邀請`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
