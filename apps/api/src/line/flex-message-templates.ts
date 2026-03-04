import { LineMessage } from './line-platform-client.js';

export function buildWelcomeFlexMessage(
  tenantName: string,
  options?: { showRegistration?: boolean }
): LineMessage {
  const showRegistration = options?.showRegistration ?? false;

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    hero: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: '歡迎使用 ONE TEAM',
          weight: 'bold',
          size: 'xl',
          align: 'center',
          color: '#1DB446'
        }
      ],
      paddingAll: '20px',
      backgroundColor: '#F5F7FA'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: tenantName,
          weight: 'bold',
          size: 'lg'
        },
        {
          type: 'text',
          text: showRegistration
            ? '歡迎加入！請點選下方按鈕申請開通您的員工身份。'
            : '歡迎加入！請從下方選單使用員工服務。',
          wrap: true,
          margin: 'md',
          color: '#666666'
        }
      ]
    }
  };

  if (showRegistration) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: {
            type: 'postback',
            label: '開始申請',
            data: 'action=request_access',
            displayText: '申請開通'
          },
          style: 'primary',
          color: '#1DB446'
        }
      ]
    };
  }

  return {
    type: 'flex',
    altText: `歡迎使用 ${tenantName} ONE TEAM`,
    contents: bubble
  };
}

export function buildAccessConfirmationFlexMessage(
  status: 'APPROVED' | 'REJECTED',
  tenantName: string
): LineMessage {
  const isApproved = status === 'APPROVED';
  const emoji = isApproved ? '✅' : '❌';
  const title = isApproved ? '存取申請已通過' : '存取申請未通過';
  const body = isApproved
    ? `您在 ${tenantName} 的存取申請已通過！現在可以使用員工服務了。`
    : `您在 ${tenantName} 的存取申請未通過。如有疑問請聯絡管理員。`;

  return {
    type: 'flex',
    altText: `${emoji} ${title}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `${emoji} ${title}`,
            weight: 'bold',
            size: 'lg'
          },
          {
            type: 'text',
            text: body,
            wrap: true,
            margin: 'md',
            color: '#666666'
          }
        ]
      }
    }
  };
}

export function buildOffboardingNotificationFlexMessage(tenantName: string): LineMessage {
  return {
    type: 'flex',
    altText: `${tenantName} 帳號離職通知`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '帳號離職通知',
            weight: 'bold',
            size: 'lg',
            color: '#CC0000'
          },
          {
            type: 'text',
            text: `您在 ${tenantName} 的員工帳號已被管理員離職處理。相關服務已停止使用。`,
            wrap: true,
            margin: 'md',
            color: '#666666'
          }
        ]
      }
    }
  };
}

export interface AdminDashboardStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export function buildAdminDashboardFlexMessage(stats: AdminDashboardStats): LineMessage {
  return {
    type: 'flex',
    altText: `管理後台 — 待審核 ${stats.pending}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '管理後台',
            weight: 'bold',
            size: 'xl',
            color: '#1a73e8'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          buildStatRow('待審核', stats.pending, '#e67e22'),
          buildStatRow('已核准', stats.approved, '#27ae60'),
          buildStatRow('已拒絕', stats.rejected, '#e74c3c'),
          {
            type: 'separator',
            margin: 'md'
          },
          buildStatRow('總計', stats.total, '#333333')
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: '查看待審核',
              data: 'action=admin_list',
              displayText: '查看待審核'
            },
            style: 'primary',
            color: '#1a73e8'
          }
        ]
      }
    }
  };
}

function buildStatRow(label: string, count: number, color: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: label,
        size: 'md',
        color: '#555555',
        flex: 1
      },
      {
        type: 'text',
        text: String(count),
        size: 'md',
        weight: 'bold',
        color,
        align: 'end',
        flex: 0
      }
    ],
    margin: 'md'
  };
}

export interface PendingEmployeeInfo {
  employeeId: string;
  nickname?: string;
  boundAt: string;
}

export function buildPendingEmployeesCarouselFlexMessage(
  employees: PendingEmployeeInfo[]
): LineMessage {
  if (employees.length === 0) {
    return {
      type: 'flex',
      altText: '目前沒有待審核的員工',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '目前沒有待審核的員工',
              weight: 'bold',
              size: 'md',
              align: 'center',
              color: '#999999'
            }
          ]
        }
      }
    };
  }

  const bubbles = employees.slice(0, 10).map(emp => ({
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'text',
          text: emp.nickname ? `${emp.nickname} (${emp.employeeId})` : `員工 ${emp.employeeId}`,
          weight: 'bold',
          size: 'lg'
        },
        {
          type: 'text',
          text: '⏳ 待審核',
          margin: 'sm',
          color: '#e67e22'
        },
        {
          type: 'text',
          text: `綁定 ${emp.boundAt.slice(0, 10)}`,
          margin: 'sm',
          size: 'sm',
          color: '#999999'
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'horizontal',
      contents: [
        {
          type: 'button',
          action: {
            type: 'postback',
            label: '✅ 核准',
            data: `action=admin_approve&eid=${emp.employeeId}`,
            displayText: `核准 ${emp.employeeId}`
          },
          style: 'primary',
          color: '#27ae60',
          flex: 1
        },
        {
          type: 'button',
          action: {
            type: 'postback',
            label: '❌ 拒絕',
            data: `action=admin_reject&eid=${emp.employeeId}`,
            displayText: `拒絕 ${emp.employeeId}`
          },
          style: 'primary',
          color: '#e74c3c',
          flex: 1,
          margin: 'sm'
        }
      ],
      spacing: 'sm'
    }
  }));

  return {
    type: 'flex',
    altText: `待審核員工 (${employees.length})`,
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };
}

export function buildAdminActionResultFlexMessage(input: {
  action: 'APPROVE' | 'REJECT';
  employeeId: string;
}): LineMessage {
  const isApprove = input.action === 'APPROVE';
  const statusText = isApprove ? '已核准' : '已拒絕';
  const statusColor = isApprove ? '#27ae60' : '#e74c3c';

  return {
    type: 'flex',
    altText: `${statusText}員工 ${input.employeeId}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: statusText,
            weight: 'bold',
            size: 'xl',
            color: statusColor,
            align: 'center'
          },
          {
            type: 'text',
            text: `${statusText}員工 ${input.employeeId} 的存取請求`,
            wrap: true,
            margin: 'md',
            align: 'center',
            color: '#666666'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: '返回管理後台',
              data: 'action=admin_dashboard',
              displayText: '管理後台'
            },
            style: 'secondary'
          }
        ]
      }
    }
  };
}

export function buildNewAccessRequestNotificationFlexMessage(input: {
  employeeId: string;
  requestedAt: string;
}): LineMessage {
  return {
    type: 'flex',
    altText: `員工 ${input.employeeId} 申請開通`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '新員工申請開通',
            weight: 'bold',
            size: 'lg',
            color: '#e67e22'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `工號：${input.employeeId}`,
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `申請時間：${input.requestedAt.slice(0, 16).replace('T', ' ')}`,
            margin: 'sm',
            size: 'sm',
            color: '#999999'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: '✅ 核准',
              data: `action=admin_approve&eid=${input.employeeId}`,
              displayText: `核准 ${input.employeeId}`
            },
            style: 'primary',
            color: '#27ae60',
            flex: 1
          },
          {
            type: 'button',
            action: {
              type: 'postback',
              label: '❌ 拒絕',
              data: `action=admin_reject&eid=${input.employeeId}`,
              displayText: `拒絕 ${input.employeeId}`
            },
            style: 'primary',
            color: '#e74c3c',
            flex: 1,
            margin: 'sm'
          }
        ],
        spacing: 'sm'
      }
    }
  };
}

export function buildDigitalIdFlexMessage(employeeId: string): LineMessage {
  const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(employeeId)}&size=300&margin=1`;

  return {
    type: 'flex',
    altText: `員工證 — ${employeeId}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '數位員工證',
            weight: 'bold',
            size: 'xl',
            align: 'center',
            color: '#1a73e8'
          }
        ],
        paddingBottom: '0px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'image',
            url: qrUrl,
            size: 'lg',
            aspectRatio: '1:1',
            aspectMode: 'fit'
          },
          {
            type: 'separator',
            margin: 'lg'
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '工號',
                size: 'sm',
                color: '#999999',
                align: 'center'
              },
              {
                type: 'text',
                text: employeeId,
                weight: 'bold',
                size: 'xxl',
                align: 'center',
                color: '#333333',
                margin: 'sm'
              }
            ],
            margin: 'lg'
          }
        ]
      },
      styles: {
        header: {
          backgroundColor: '#F5F7FA'
        }
      }
    }
  };
}

export function buildServicesMenuFlexMessage(options?: {
  isAdmin?: boolean;
  liffWebBaseUrl?: string;
  tenantId?: string;
  accessToken?: string;
  refreshToken?: string;
}): LineMessage {
  const liffWebBase = options?.liffWebBaseUrl ?? 'https://miniapp.line.me/';
  const enabledServices = ['volunteer', 'massage'];

  const allServices = [
    { id: 'volunteer', label: '志工活動', desc: '查詢與報名志工活動', path: '/volunteer' },
    { id: 'massage', label: '按摩預約', desc: '預約公司按摩服務', path: '/massage' },
    { id: 'voting', label: '投票', desc: '參與公司投票', path: '/voting' },
    { id: 'packages', label: '包裹簽收', desc: '簽收包裹通知', path: '/packages' },
    { id: 'repair', label: '總務報修', desc: '提交報修申請', path: '/repair' },
    { id: 'visitor', label: '訪客登記', desc: '登記訪客到訪', path: '/visitor' },
  ];

  const bubbles: unknown[] = [
    {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '員工證',
            weight: 'bold',
            size: 'lg'
          },
          {
            type: 'text',
            text: '查看您的數位員工證',
            margin: 'sm',
            color: '#666666',
            wrap: true
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: '員工證',
              data: 'action=digital_id',
              displayText: '員工證'
            },
            style: 'primary',
            color: '#1a73e8'
          }
        ]
      }
    }
  ];

  for (const svc of allServices) {
    const enabled = enabledServices.includes(svc.id);
    bubbles.push({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: svc.label,
            weight: 'bold',
            size: 'lg',
            color: enabled ? '#333333' : '#999999'
          },
          {
            type: 'text',
            text: enabled ? svc.desc : `${svc.desc}（即將推出）`,
            margin: 'sm',
            color: enabled ? '#666666' : '#BBBBBB',
            wrap: true
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: enabled
              ? {
                  type: 'uri',
                  label: svc.label,
                  uri: options?.accessToken
                    ? `${liffWebBase}${svc.path}?tenantId=${encodeURIComponent(options.tenantId ?? '')}&accessToken=${encodeURIComponent(options.accessToken)}${options.refreshToken ? `&refreshToken=${encodeURIComponent(options.refreshToken)}` : ''}`
                    : `${liffWebBase}${svc.path}`,
                }
              : {
                  type: 'postback',
                  label: '即將推出',
                  data: `action=coming_soon&service=${svc.id}`,
                  displayText: svc.label,
                },
            style: 'primary',
            color: enabled ? '#1DB446' : '#CCCCCC'
          }
        ]
      }
    });
  }

  if (options?.isAdmin) {
    const adminUrl = options.accessToken
      ? `${liffWebBase}/admin?tenantId=${encodeURIComponent(options.tenantId ?? '')}&accessToken=${encodeURIComponent(options.accessToken)}${options.refreshToken ? `&refreshToken=${encodeURIComponent(options.refreshToken)}` : ''}`
      : `${liffWebBase}/admin`;

    bubbles.push({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '管理後台',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: '審核員工申請、管理權限',
            margin: 'sm',
            color: '#666666',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: '管理後台',
              uri: adminUrl,
            },
            style: 'primary',
            color: '#1a73e8',
          },
        ],
      },
    });
  }

  return {
    type: 'flex',
    altText: '員工服務',
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };
}
