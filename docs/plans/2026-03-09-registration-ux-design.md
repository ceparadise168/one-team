# Employee Registration UX Improvement

## Problem

The current employee registration flow has two UX pain points:

1. **Input cognitive gap** — After tapping "開始申請", the bot replies "please enter your employee ID" but users don't know where to type. They must minimize the rich menu, bring up the keyboard, and send a text message.
2. **Post-submission blank period** — After submitting, the success message is vague ("申請已送出，請等候管理員審核") with no guidance on what happens next.

## Design

### 1. Rich Menu Entry Point

Change the "申請開通" button from a postback action (`action=request_access`) to a URI action that opens the LIFF registration page directly. Users tap the button and land on a clear form.

### 2. LIFF Registration Form Enhancement

- Add optional "nickname" field with placeholder "你期望怎麼被稱呼呢？"
- Use Tailwind styling consistent with other LIFF pages

### 3. Success Page

Replace the minimal success message with:
- Confirmation icon + "申請已送出"
- Clear next-step explanation: "管理員已收到通知，審核通過後您會收到 LINE 訊息"
- Close button that calls `liff.closeWindow()`

### 4. Backend Changes

- Accept optional `nickname` in `self-register` endpoint
- Store in binding record's `nickname` field
- Keep webhook text-input registration as fallback

### Out of Scope

- No changes to push notification (approval result already sends LINE message)
- No status query feature
- No changes to admin approval flow
