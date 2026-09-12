import type { ProductQuestionType } from '../models/ProductCompliance';

export const SYSTEM_SEED_USER_ID = '00000000-0000-0000-0000-000000000000';

export interface SeedQuestion {
  stableKey: string;
  title: string;
  description: string | null;
  questionType: ProductQuestionType;
  required: boolean;
  options: string[];
}

export interface DataCatalogSeed {
  stableKey: string;
  dataSubject: string;
  category: string;
  name: string;
  sensitive: boolean;
  required: boolean;
}

export interface ThirdPartyAssessmentSeed {
  stableKey: string;
  section: string;
  sequence: string;
  title: string;
}

export const BASELINE_COMPLIANCE_QUESTIONS: SeedQuestion[] = [
  {
    "stableKey": "baseline_4",
    "title": "产品 / 业务是否涉及：针对儿童的个人数据的收集 / 处理？ 注：儿童：未满 14 周岁的个人",
    "description": "其他信息，请在此补充说明：",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "否，不涉及针对儿童的个人数据收集 / 处理功能和行为",
      "是，存在如下儿童数据处理行为"
    ]
  },
  {
    "stableKey": "baseline_5_1",
    "title": "产品 / 业务是否涉及个性化功能 / 场景？",
    "description": "其他信息，请在此补充说明：",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "否，个性化功能场景不涉及",
      "是，存在个性化功能场景"
    ]
  },
  {
    "stableKey": "baseline_5_2",
    "title": "产品 / 业务是否涉及在中国境内，利用深度内容合成技术提供服务？",
    "description": "其他信息，请在此补充说明：",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "否，以下 \"深度内容合成\" 技术相关的功能 / 场景 / 数据处理活动均不涉及",
      "是，存在深度内容合成技术，即利用深度学习、虚拟现实等生成合成类算法制作文本、图像、音频、视频、虚拟场景等网络信息的技术，包括："
    ]
  },
  {
    "stableKey": "baseline_5_3",
    "title": "产品 / 业务是否涉及在中国境内使用算法推荐技术，提供互联网信息服务？",
    "description": "其他信息，请在此补充说明：",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "否，以下 \"算法推荐\" 相关的功能 / 场景 / 数据处理活动均不涉及",
      "是，存在利用算法推荐技术向中国境内提供产品服务，包括："
    ]
  },
  {
    "stableKey": "baseline_5_4",
    "title": "产品 / 业务是否涉及利用生成式人工智能（AI）即：基于算法、模型、规则，生成文本、图片、声音、视频、代码等内容；并面向中国境内公众提供产品 / 服务？",
    "description": "其他信息，请在此补充说明：",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "否，不涉及利用 “生成式人工智能技术” 向中国境内提供生成文本、图片、音频、视频等内容的服务",
      "o 不涉及生成式人工智能 AI 模型",
      "o 不对外提供 AI 服务，仅对声网内部提供服务",
      "o 不对中国境内提供 AIGC 模型 / 服务",
      "是，涉及利用 “生成式人工智能技术” 向中国境内提供产品服务（生成文本、图片、音频、视频等内容）"
    ]
  },
  {
    "stableKey": "baseline_6",
    "title": "产品 / 业务是否涉及从境内访问境外 ChatGPT 的代理服务？",
    "description": "其他信息，请在此补充说明：",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "否，不涉及提供任何代理服务 / 产品等，使用户能够从中国境内访问境外 ChatGPT、OpenAI 等智能聊天工具服务",
      "是，涉及提供代理服务 / 产品等，使用户能够从中国境内访问境外 ChatGPT、OpenAI 的代理服务"
    ]
  },
  {
    "stableKey": "baseline_7",
    "title": "产品 / 业务收集的个人信息存储在什么国家 / 区域？ 备注：日志信息包括不限于：设备类型、设备型号、CPU 信息、电池电量信息、操作系统信息；IP 地址、网络类型；UID、CID、用户属性、频道信息、使用时长、频道内设置名称等日志",
    "description": "其他信息，请在此补充说明：发生崩溃时会主动，当前策略移动端会下发日志上传指令",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "终端用户 - 网络 / 设备标识、操作日志数据（参考右侧备注）",
      "o 不存储日志数据",
      "o 存储部署 / 上报在：存储在本地并加密",
      "终端用户 - 传输内容数据：（音频 / 视频录制内容；历史消息；图片 / 抽帧；文件等），数据部署存储在：",
      "o 存储部署 / 上报在：",
      "（企业）客户 / 开发者 - 注册 / 联系人信息（如：姓名、手机号、邮箱、银行账号等），数据部署存储在："
    ]
  },
  {
    "stableKey": "baseline_8",
    "title": "产品的功能是否满足设计、默认隐私和安全原则？",
    "description": null,
    "questionType": "multi_select",
    "required": false,
    "options": [
      "1. 数据传输安全 - 传输通道加密",
      "否，传输通道尚无加密机制",
      "是，传输通道有加密机制：",
      "2. 数据传输安全 - 传输内容加密（如：音视频媒体流、消息等）",
      "否，产品尚未让客户选择自行对传输内容进行加密",
      "是，客户可以选择自行对传输内容加密",
      "3. 数据存储安全 - 存储数据加密（用户 / 客户的敏感个人信息；或内容数据）",
      "否。存储用户 / 客户的敏感个人信息或内容数据，但尚未对数据进行存储加密",
      "是，产品对用户 / 客户的敏感个人信息或内容数据，采取了存储加密",
      "N/A，产品不涉及存储用户 / 客户敏感个人信息或内容数据",
      "4. 数据存储安全 - 存储密钥是否由客户控制",
      " 否。数据存储在声网云服务；声网团队管理云存储密钥，并对用户内容数据有访问 / 读的权限",
      " 是。数据存储在声网云服务；云存储密钥仅由客户控制；声网对用户内容数据没有访问 / 读权限",
      " N/A，用户内容数据，不存储在声网，仅存储在客户指定的云服务",
      " N/A，产品不涉及数据存储功能",
      "5. 数据存储限制 - 日志数据",
      " N/A，日志不会打印用户个人信息",
      " 日志统一上报给数据平台，并会定期清理",
      " 日志由产品自行存储，定义了数据存储期限；并且，会到期清理",
      " 日志由产品自行存储，涉及存储用户个人信息，但尚未明确存储期限，并且暂无删除机制",
      "6. 数据存储限制 - 用户 / 客户内容数据（音频 / 视频录制内容；消息内容；文件内容等）",
      " N/A。不会存储用户内容数据",
      " 是，客户可配置选择数据存储期限，数据到期数据",
      " 否，没有明确的存储期限，不会删除",
      "7. 数据存储限制 - 客户 / 用户个人信息（如：个人注册信息、联络信息、身份信息等）",
      " N/A。不会存储客户 / 用户个人信息",
      " 是，客户 / 用户注销账号后会删除其数据",
      " 否，暂无数据删除机制",
      "8. 数据脱敏处理 - 系统界面脱敏",
      " N/A。系统界面不显示用户 / 客户个人信息（姓名、手机、邮箱、银行账号；消息内容等）",
      " 是，对系统界面的用户 / 客户个人信息或敏感数据去标识化处理（如脱敏、哈希等）",
      " 否，不会对系统界面的用户 / 客户个人信息或敏感数据去标识化处理",
      " 其他（请解释说明：）",
      "9. 数据脱敏处理 - 日志脱敏处理",
      " N/A。日志不会包含个人信息（姓名、手机、邮箱、银行账号；消息等）",
      " 是，对于日志中的个人信息，已去标识化处理（如哈希、脱敏等）",
      " 否，对于日志中的个人信息，不会进行去标识化处理",
      " 其他（请解释说明：___________________________________）"
    ]
  },
  {
    "stableKey": "baseline_10",
    "title": "产品 / 业务是否向第三方共享 / 传输个人信息？",
    "description": "其他信息，请在此补充说明：bugly，待补充",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "1. 产品 / 业务是否用第三方云服务，传输、存储、处理客户数据或个人信息？",
      "o 否，不涉及向第三方传输个人信息和内容数据",
      "o 是，涉及使用第三方云服务传输或存储客户数据、用户个人信息",
      "2. 产品 / 业务是否向其他第三方共享或提供客户数据、用户的个人信息？",
      " 否，不涉及",
      " 是，涉及向第三方共享或提供客户数据、用户个人信息"
    ]
  },
  {
    "stableKey": "baseline_11",
    "title": "产品是否能让终端用户向互联网发布 / 转发消息？（包括：创作发布、传播 / 转发 / 转载等，常见于 App；官网论坛；博客等）",
    "description": "其他信息，请在此补充说明：",
    "questionType": "multi_select",
    "required": false,
    "options": [
      "否，不涉及信息内容发布或传播",
      "是（请具体说明内容场景：____________________）"
    ]
  }
];

export const APP_COMPLIANCE_QUESTIONS: SeedQuestion[] = [
  {
    "stableKey": "app_check_001",
    "title": "App公司实体信息准确 （App发布到官网/应用商店的信息与App在隐私政策声明的公司实体信息一致；且应该显示公司全称）",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能\n请说明： App名称：_______________________ 公司实体名称：__________________ 设备端类型：_____________________",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_002",
    "title": "App/Demo发布渠道方式",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能\n官方发布 是否在官网发布 是否在应用商店发布 非官方提供 是否在GitHub / TestFlight 是否在仅提供工程代码 是否在仅线下向客户分发 其他（请补充）",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_003",
    "title": "App首次运行，是否触发隐私弹窗，弹窗界面附带单独的隐私政策+用户协议链接？",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_004",
    "title": "App隐私政策等收集使用规则，是否确保不会难以访问 如：进入App主界面后，需多于4次点击等操作才能访问到；",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_005",
    "title": "App首次运行，是否触发隐私弹窗，获得用户主动同意（主动勾选/点击等） 注：通过弹窗明确告知用户收集/使用权限或个人信息的目的、方式、范围等；并获用户做出明确授权的行为。",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_006",
    "title": "App隐私弹窗，是否不会强制用户同意/提供权限？包括： 不会默认同意（默认勾选同意；或【点击隐私政策即代表同意】） 不会捆绑同意（捆绑申请权限；或未经授权，就默认开启权限） 不会强制索权（拒绝授权申请，就退出App或不允许注册/登录） 不会过度索权（未触发相关应用功能，提前弹窗申请权限）",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_007",
    "title": "App隐私政策，是否展示了App个人信息收集清单？",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_008",
    "title": "是否在App的二级菜单（路径：我的设置-个人信息收集清单）向用户展示，易于点击访问【个人信息收集清单】内容？",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_009",
    "title": "不会收集设备唯一标识、敏感应用信息",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_010",
    "title": "App隐私政策，是否附带展示“权限清单”？",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_011",
    "title": "App隐私政策，是否附带并展示\"第三方共享个信息清单\"（App双清单）？",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_012",
    "title": "是否在App二级菜单（路径：我的设置-第三方共享个人信息清单）向用户展示，易于点击访问的【第三方共享个人信息清单】内容？",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_013",
    "title": "是否提供用户账号注销功能（优选线上功能），注销功能/操作简便",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_014",
    "title": "App是否向用户提供个人信息权利实现的功能，包括：个人信息查询、修改、删除等",
    "description": "APP上线前必须具备的功能，且不能因为版本更新取消此类功能",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_015",
    "title": "不涉及超范围，或超出目的收集敏感个人信息",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_016",
    "title": "不涉及超频率/频度，采集个人信息，包括： App超频收集 App静默后台超频收集 SDK超频收集 SDK静默后台超频收集",
    "description": "APP迭代、更新不能违背的基线安全要求\nApp采集或处理个人信息超频典型场景事例： 超频场景1：按固定频率收集或处理个人信息（如：每30秒都采集或读取1次），属于超频违规； 超频场景2：每次点击某个功能就对个人信息进行收集/读取，属于超频违规； 超频场景3：用户拒绝App（首次）权限申请弹窗后，仍继续再次弹窗权限申请，属于超频（建议：用户拒绝权限弹窗申请后，如果再次点击权限相关功能，应该引导用户到手机系统设置界面，重新开启权限）",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_017",
    "title": "App不会调用非必要权限 App不会调用敏感权限 App触发特定功能，调用必要权限时；会单独弹窗获得用户同意授权",
    "description": "APP迭代、更新不能违背的基线安全要求\n敏感权限举例 手机、电视等共享文件 - 本地网络传输权限 访问精确位置权限（GPS/经纬度） 访问粗略位置权限 支持后台访问位置（行踪轨迹） 读取手机通话状态 READ_PHONE_STATE 通话记录权限 共享通讯录功能 - 读取/写入通讯录权限 读取本机电话号码 发送短信 / 拨打电话 - 电话/短信权限 读取正在运行的软件列表/应用列表 读取已安装的软件列表/应用列表 读取手机剪切板 - 读取剪切板权限 生物识别（如：人脸识别、指纹识别等） 健康与运动（如：计步、心率、健康体检等） 传感器相关功能（如：陀螺仪、加速度计等）- BODY_SENSOR 发送手机系统通知 - 系统告警通知权限",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_018",
    "title": "如果用户尚未点击或触发功能（如：语音、视频通话），App不会提前弹窗申请权限（如：麦克风、摄像头权限）",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_019",
    "title": "App不会一揽子（一次性）弹窗申请多个权限（如：打开App时同时弹窗申请权限） 注：不得要求用户一次性授权同意其未申请或使用的业务功能、个人信息的权限。",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_020",
    "title": "如果用户首次打开App，点击“不同意”App隐私政策，App不会直接关闭或闪退，也不会无法正常注册或登录App。",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_021",
    "title": "如果用户拒绝同意App权限（如：麦克风、摄像头），App不会直接关闭或闪退；APP也不会拒绝为用户提供服务",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_022",
    "title": "如果用户拒绝同意权限，App不会频繁/循环弹窗申请权限，包括： 拒绝授权后，不会（48小时内）再次弹窗申请权限 拒绝授权后，不会循环弹窗申请权限；如：每次打开App或其他功能时，都再次弹窗申请权限",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_023",
    "title": "不会在获取用户同意（同意隐私政策、同意App权限申请）前，提前调用权限或采集个人信息。",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_024",
    "title": "不会调用境外第三方SDK；且不会向境外传输个人信息；或在境外存储个人信息",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_025",
    "title": "是否具备技术措施，有效地日志监测和记录App网络运行状态、网络安全事件？",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_026",
    "title": "是否按《网络安全法》规定留存相关网络运行状态、网络安全日志不少于6个月",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  },
  {
    "stableKey": "app_check_027",
    "title": "国内App，是否已接入并实时内容审核机制 包括：涉黄、涉政、涉恐/暴、涉反动、涉网络诈骗等的内容安全检测 包括：敏感文本、语音、图片、视频（抽帧）、文件检测 能及时检测、响应、处理、记录敏感内容； 能及时有效响应处理用户举报",
    "description": "APP迭代、更新不能违背的基线安全要求",
    "questionType": "boolean",
    "required": false,
    "options": []
  }
];

export const PERSONAL_DATA_CATALOG_ITEMS: DataCatalogSeed[] = [
  {
    "stableKey": "data_003",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "姓名",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_004",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "手机号 / 个人电话号码",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_005",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "电子邮件地址",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_006",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "第三方账号信息（如：微信号等）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_007",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "头像",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_008",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "昵称",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_009",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "年龄",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_010",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "生日",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_011",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "性别",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_012",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "民族",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_013",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "国籍",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_014",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "住址 / 通讯地址",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_015",
    "dataSubject": "企业客户或者开发者",
    "category": "基本个人信息",
    "name": "家庭关系",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_016",
    "dataSubject": "企业客户或者开发者",
    "category": "个人身份信息",
    "name": "身份证",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_017",
    "dataSubject": "企业客户或者开发者",
    "category": "个人身份信息",
    "name": "其他身份信息（军官证、护照、驾驶证、工作证、出入证、社保卡、居住证等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_018",
    "dataSubject": "企业客户或者开发者",
    "category": "个人健康生理信息",
    "name": "个人健康生理信息（医疗诊断等相关记录，包括住院记录、就诊记录、过往病史、检验报告等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_019",
    "dataSubject": "企业客户或者开发者",
    "category": "个人金融财产信息",
    "name": "个人金融账号信息（如：银行账号）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_020",
    "dataSubject": "企业客户或者开发者",
    "category": "个人金融财产信息",
    "name": "个人金融鉴别信息（口令）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_021",
    "dataSubject": "企业客户或者开发者",
    "category": "个人金融财产信息",
    "name": "个人交易和消费记录、流水记录等",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_022",
    "dataSubject": "企业客户或者开发者",
    "category": "个人金融财产信息",
    "name": "个人虚拟财产信息（虚拟货币、虚拟交易、游戏兑换码等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_023",
    "dataSubject": "企业客户或者开发者",
    "category": "个人金融财产信息",
    "name": "其他金融信息（存款信息、信贷记录、房产信息、征信信息）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_024",
    "dataSubject": "企业客户或者开发者",
    "category": "生物识别特征信息",
    "name": "面部识别特征（人脸识别信息）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_025",
    "dataSubject": "企业客户或者开发者",
    "category": "生物识别特征信息",
    "name": "指纹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_026",
    "dataSubject": "企业客户或者开发者",
    "category": "生物识别特征信息",
    "name": "声纹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_027",
    "dataSubject": "企业客户或者开发者",
    "category": "生物识别特征信息",
    "name": "掌纹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_028",
    "dataSubject": "企业客户或者开发者",
    "category": "生物识别特征信息",
    "name": "耳廓",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_029",
    "dataSubject": "企业客户或者开发者",
    "category": "生物识别特征信息",
    "name": "虹膜",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_030",
    "dataSubject": "企业客户或者开发者",
    "category": "生物识别特征信息",
    "name": "个人基因",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_031",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "性取向",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_032",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "婚史",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_033",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "宗教信仰",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_034",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "政治倾向",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_035",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "种族",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_036",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "未公开的犯罪记录",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_037",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "通信记录和内容",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_038",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "通讯录",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_039",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "好友、群组列表",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_040",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "行踪轨迹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_041",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "网页浏览记录和内容",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_042",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "住宿信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_043",
    "dataSubject": "企业客户或者开发者",
    "category": "其他敏感个人信息",
    "name": "精准定位信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_044",
    "dataSubject": "企业客户或者开发者",
    "category": "其他",
    "name": "_____________________________",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_045",
    "dataSubject": "声网员工",
    "category": "基本信息",
    "name": "姓名",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_046",
    "dataSubject": "声网员工",
    "category": "基本信息",
    "name": "邮箱",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_047",
    "dataSubject": "声网员工",
    "category": "基本信息",
    "name": "手机号",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_048",
    "dataSubject": "声网员工",
    "category": "基本信息",
    "name": "年龄",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_049",
    "dataSubject": "声网员工",
    "category": "基本信息",
    "name": "性别",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_050",
    "dataSubject": "声网员工",
    "category": "基本信息",
    "name": "住址 / 通信地址",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_051",
    "dataSubject": "声网员工",
    "category": "岗位职级信息",
    "name": "岗位职级信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_052",
    "dataSubject": "声网员工",
    "category": "工作学习履历信息",
    "name": "工作学习履历信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_053",
    "dataSubject": "声网员工",
    "category": "个人身份信息",
    "name": "身份证",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_054",
    "dataSubject": "声网员工",
    "category": "个人身份信息",
    "name": "其他身份信息（军官证、护照、驾驶证、工作证、社保卡、居住证等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_055",
    "dataSubject": "声网员工",
    "category": "金融账号信息",
    "name": "金融账号（如：银行账号）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_056",
    "dataSubject": "声网员工",
    "category": "工作奖惩信息",
    "name": "工作奖惩信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_057",
    "dataSubject": "声网员工",
    "category": "紧急联系 / 联络人",
    "name": "紧急联系 / 联络人",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_058",
    "dataSubject": "声网员工",
    "category": "社保信息",
    "name": "社保信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_059",
    "dataSubject": "声网员工",
    "category": "薪酬相关信息",
    "name": "薪酬相关信息（薪资 / 工资、奖金、期权、股票、RSU、股份、VPP 等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_060",
    "dataSubject": "声网员工",
    "category": "绩效信息",
    "name": "绩效信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_061",
    "dataSubject": "声网员工",
    "category": "生物特征信息",
    "name": "生物特征信息（如：指纹、声纹、虹膜、人脸识别特征等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_062",
    "dataSubject": "声网员工",
    "category": "其他基本信息",
    "name": "籍贯",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_063",
    "dataSubject": "声网员工",
    "category": "其他基本信息",
    "name": "民族",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_064",
    "dataSubject": "声网员工",
    "category": "其他基本信息",
    "name": "生理健康信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_065",
    "dataSubject": "声网员工",
    "category": "其他基本信息",
    "name": "政治面貌",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_066",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "未公开的犯罪记录",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_067",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "性取向",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_068",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "婚史",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_069",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "宗教信仰",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_070",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "通信记录和内容",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_071",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "通讯录",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_072",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "行踪轨迹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_073",
    "dataSubject": "声网员工",
    "category": "其他敏感信息",
    "name": "精准定位信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_074",
    "dataSubject": "声网员工",
    "category": "请补充：",
    "name": "_____________________________",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_075",
    "dataSubject": "终端用户",
    "category": "传输内容数据",
    "name": "文字消息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_076",
    "dataSubject": "终端用户",
    "category": "传输内容数据",
    "name": "图片消息（设备相册）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_077",
    "dataSubject": "终端用户",
    "category": "传输内容数据",
    "name": "文件消息（设备存储文件）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_078",
    "dataSubject": "终端用户",
    "category": "传输内容数据",
    "name": "实时音频（设备麦克风）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_079",
    "dataSubject": "终端用户",
    "category": "传输内容数据",
    "name": "实时视频（设备摄像头）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_080",
    "dataSubject": "终端用户",
    "category": "传输内容数据",
    "name": "音视频云录制",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_081",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "设备型号",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_082",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "设备品牌",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_083",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "操作系统版本",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_084",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "设备 CPU 信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_085",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "设备内存使用情况信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_086",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "设备电池电量信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_087",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "设备屏幕分辨率信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_088",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "传感器信息 - 屏幕旋转角度信息（使得视频通话对端保持画面水平）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_089",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "其他传感器信息（如有，请说明：___________________________）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_090",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "设备 MAC 地址",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_091",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "硬件序列号",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_092",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "IMEI",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_093",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "SIM 卡 IMSI 信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_094",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "ICCID（SIM 卡唯一认证码）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_095",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "Android ID",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_096",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "OpenUDID",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_097",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "IDFA",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_098",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "IDFV",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_099",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "GUID",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_100",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "UUID",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_101",
    "dataSubject": "终端用户",
    "category": "终端用户设备信息",
    "name": "其他（如有，请说明：______________________________）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_102",
    "dataSubject": "终端用户",
    "category": "终端用户网络状况信息",
    "name": "动态 IP 地址",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_103",
    "dataSubject": "终端用户",
    "category": "终端用户网络状况信息",
    "name": "网络类型",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_104",
    "dataSubject": "终端用户",
    "category": "终端用户网络状况信息",
    "name": "Wi-fi 信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_105",
    "dataSubject": "终端用户",
    "category": "终端用户网络状况信息",
    "name": "蓝牙信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_106",
    "dataSubject": "终端用户",
    "category": "终端用户网络状况信息",
    "name": "信号强度信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_107",
    "dataSubject": "终端用户",
    "category": "终端用户网络状况信息",
    "name": "基站位置名称信息",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_108",
    "dataSubject": "终端用户",
    "category": "终端用户网络状况信息",
    "name": "网络运营商名称",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_109",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "用户 UID",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_110",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "用户属性 - 昵称",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_111",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "用户属性 - 头像",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_112",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "用户属性 - 性别",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_113",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "用户属性 - 年龄",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_114",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "用户属性 - 生日",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_115",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "用户属性 - 其他个人特征标签等（如有，请说明：___________________________）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_116",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "频道信息 - 房间名/房间ID",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_117",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "频道信息 - 群名",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_118",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "频道信息 - 直播间名",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_119",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "频道信息 - 班级 / 教室名",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_120",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "频道信息 - 其他自定义频道内名称等（如有，请说明：______________________________）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_121",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "频道使用时长；进入、退出时间",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_122",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "消费金额和记录",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_123",
    "dataSubject": "终端用户",
    "category": "终端用户的产品 / 频道交互信息",
    "name": "其他（如有，请说明：______________________________）",
    "sensitive": false,
    "required": false
  },
  {
    "stableKey": "data_124",
    "dataSubject": "终端用户",
    "category": "个人身份信息",
    "name": "身份证",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_125",
    "dataSubject": "终端用户",
    "category": "个人身份信息",
    "name": "其他身份信息（军官证、护照、驾驶证、工作证、出入证、社保卡、居住证等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_126",
    "dataSubject": "终端用户",
    "category": "个人健康生理信息",
    "name": "个人健康生理信息（医疗诊断等相关记录，包括住院记录、就诊记录、过往病史、检验报告等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_127",
    "dataSubject": "终端用户",
    "category": "个人金融财产信息",
    "name": "个人金融账号信息（如：银行账号）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_128",
    "dataSubject": "终端用户",
    "category": "个人金融财产信息",
    "name": "个人金融鉴别信息（口令）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_129",
    "dataSubject": "终端用户",
    "category": "个人金融财产信息",
    "name": "个人交易和消费记录、流水记录等",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_130",
    "dataSubject": "终端用户",
    "category": "个人金融财产信息",
    "name": "个人虚拟财产信息（虚拟货币、虚拟交易、游戏兑换码等）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_131",
    "dataSubject": "终端用户",
    "category": "个人金融财产信息",
    "name": "其他金融信息（存款信息、信贷记录、房产信息、征信信息）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_132",
    "dataSubject": "终端用户",
    "category": "生物识别特征信息",
    "name": "面部识别特征（人脸识别信息）",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_133",
    "dataSubject": "终端用户",
    "category": "生物识别特征信息",
    "name": "指纹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_134",
    "dataSubject": "终端用户",
    "category": "生物识别特征信息",
    "name": "声纹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_135",
    "dataSubject": "终端用户",
    "category": "生物识别特征信息",
    "name": "掌纹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_136",
    "dataSubject": "终端用户",
    "category": "生物识别特征信息",
    "name": "耳廓",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_137",
    "dataSubject": "终端用户",
    "category": "生物识别特征信息",
    "name": "虹膜",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_138",
    "dataSubject": "终端用户",
    "category": "生物识别特征信息",
    "name": "个人基因",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_139",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "性取向",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_140",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "婚史",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_141",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "宗教信仰",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_142",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "政治倾向",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_143",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "种族",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_144",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "未公开的犯罪记录",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_145",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "通信记录和内容",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_146",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "通讯录",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_147",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "好友、群组列表",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_148",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "行踪轨迹",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_149",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "网页浏览记录",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_150",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "住宿信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_151",
    "dataSubject": "终端用户",
    "category": "其他敏感个人信息",
    "name": "精准定位信息",
    "sensitive": true,
    "required": false
  },
  {
    "stableKey": "data_152",
    "dataSubject": "终端用户",
    "category": "请补充：",
    "name": "_____________________________",
    "sensitive": false,
    "required": false
  }
];

export const THIRD_PARTY_ASSESSMENT_ITEMS: ThirdPartyAssessmentSeed[] = [
  {
    "stableKey": "tpa_004",
    "section": "",
    "sequence": "1",
    "title": "第三方是否具备网络安全、信息安全、个人信息/隐私保护相关的资质认证？包括： • 网络安全等级保护（三级）测评报告 • ISO认证（ISO27001信息安全、ISO27701隐私管理；ISO27017、ISO27018、ISO22301等） • SOC 2 / SOC3 鉴证服务报告 • 其他安全合规资质/认证/报告"
  },
  {
    "stableKey": "tpa_005",
    "section": "",
    "sequence": "2",
    "title": "第三方是否与声网签订了保密协议？"
  },
  {
    "stableKey": "tpa_006",
    "section": "",
    "sequence": "3",
    "title": "如果第三方提供的是外包服务（专项），外包项目相关人员是否签署了保密协议？"
  },
  {
    "stableKey": "tpa_009",
    "section": "",
    "sequence": "1",
    "title": "第三方供应商是否对员工实施安全管控？包括： 对离职人员的：系统权限及时禁用、设备资产及时回收、签署必要的离职保密承诺书等？"
  },
  {
    "stableKey": "tpa_010",
    "section": "",
    "sequence": "2",
    "title": "第三方供应商是否定期对员工开展信息安全和隐私数据保护相关的培训？"
  },
  {
    "stableKey": "tpa_013",
    "section": "",
    "sequence": "1",
    "title": "第三方的数据中心（服务器/数据库等）是否部署在中国境内?"
  },
  {
    "stableKey": "tpa_014",
    "section": "",
    "sequence": "2",
    "title": "第三方的数据中心是否满足物理安全要求?（遵循网络安全等级保护、ISO27001等标准要求）"
  },
  {
    "stableKey": "tpa_017",
    "section": "",
    "sequence": "1",
    "title": "第三方是否建立访问控制制度要求，并且确保安全的登录/身份验证机制？"
  },
  {
    "stableKey": "tpa_018",
    "section": "",
    "sequence": "2",
    "title": "第三方是否使用了强的密码策略，包括：密码长度（8位以上）、复杂度（包括大写字母、小写字母、数字、特殊字符）、定期更新等"
  },
  {
    "stableKey": "tpa_019",
    "section": "",
    "sequence": "3",
    "title": "第三方是否控制访问权限，并严格限制仅最少且必要的人员才能访问系统？"
  },
  {
    "stableKey": "tpa_020",
    "section": "",
    "sequence": "4",
    "title": "第三方是否限制人员批量下载/导出/操作系统数据？"
  },
  {
    "stableKey": "tpa_021",
    "section": "",
    "sequence": "5",
    "title": "第三方人员离职时，是否及时删除系统/数据的访问权限；回收其所有资产设备？"
  },
  {
    "stableKey": "tpa_022",
    "section": "",
    "sequence": "6",
    "title": "第三方是否开启系统操作日志？并定期开展日志审计？"
  },
  {
    "stableKey": "tpa_023",
    "section": "",
    "sequence": "7",
    "title": "第三方是否定期对数据系统开展权限复核和审阅？"
  },
  {
    "stableKey": "tpa_024",
    "section": "",
    "sequence": "8",
    "title": "第三方是否允许远程访问系统数据? 远程访问是否通过VPN/白名单控制？并且需严格授权审批？"
  },
  {
    "stableKey": "tpa_027",
    "section": "",
    "sequence": "1",
    "title": "第三方提供的产品/服务上线前是否开展安全合规评估、个人信息影响评估?"
  },
  {
    "stableKey": "tpa_028",
    "section": "",
    "sequence": "2",
    "title": "第三方对自己所提供的产品/服务，是否（聘请专业测评机构）定期开展渗透测试、漏洞扫描？ 请第三方提供（专业测评机构）特定产品/服务的渗透测试报告和漏洞扫描报告。"
  },
  {
    "stableKey": "tpa_029",
    "section": "",
    "sequence": "3",
    "title": "第三方是否及时扫描/检测产品服务的安全漏洞，并在上线前及时解决安全漏洞？"
  },
  {
    "stableKey": "tpa_030",
    "section": "",
    "sequence": "4",
    "title": "第三方提供的产品/服务上线前是否经过代码安全审查？"
  },
  {
    "stableKey": "tpa_031",
    "section": "",
    "sequence": "5",
    "title": "第三方的产品/服务如果涉及采用开源工具进行程序开发，是否对开源工具采取了管理措施，以确保开源工具的安全性？"
  },
  {
    "stableKey": "tpa_032",
    "section": "",
    "sequence": "6",
    "title": "第三方是否制定了安全补丁管理流程？并且确保及时管理和更新补丁？"
  },
  {
    "stableKey": "tpa_035",
    "section": "",
    "sequence": "1",
    "title": "第三方是否制定了应急预案及事件响应流程？（包括应急响应时间目标-SLA）"
  },
  {
    "stableKey": "tpa_036",
    "section": "",
    "sequence": "2",
    "title": "第三方是否采取技术手段对安全事件监测和预警？"
  },
  {
    "stableKey": "tpa_037",
    "section": "",
    "sequence": "3",
    "title": "第三方是否每年开展应急预案培训、演练？"
  },
  {
    "stableKey": "tpa_038",
    "section": "",
    "sequence": "4",
    "title": "第三方过去是否曾发生过重大信息安全事件或数据泄露事件？ 如果有，请具体说明。"
  },
  {
    "stableKey": "tpa_039",
    "section": "",
    "sequence": "5",
    "title": "第三方如果发生信息安全或数据泄露事件，如何确保及时通知声网？是否建立流程机制？"
  },
  {
    "stableKey": "tpa_042",
    "section": "",
    "sequence": "1",
    "title": "第三方是否部署了防火墙、入侵防御和入侵检测系统（IDS/IPS）？"
  },
  {
    "stableKey": "tpa_043",
    "section": "",
    "sequence": "2",
    "title": "第三方是否采取安全技术手段来预防DDOS等外部攻击？"
  },
  {
    "stableKey": "tpa_044",
    "section": "",
    "sequence": "3",
    "title": "第三方生产网络隔离是否与办公网络隔离？"
  },
  {
    "stableKey": "tpa_047",
    "section": "",
    "sequence": "1",
    "title": "第三方是否根据国家监管要求制定了数据分类分级制度？并对不同级别的数据，采取了分级保护的安全管控措施？"
  },
  {
    "stableKey": "tpa_048",
    "section": "",
    "sequence": "2",
    "title": "第三方所提供的产品/服务，如果涉及数据传输场景，则是否采取了传输加密措施？ 具体请解释使用了什么传输加密措施？ （例如：HTTPS；TLS 1.2及以上；其他传输加密机制）"
  },
  {
    "stableKey": "tpa_049",
    "section": "",
    "sequence": "3",
    "title": "第三方所提供的产品/服务，如果涉及数据存储场景，数据存储是否采取了存储加密措施？ 具体请解释使用了什么存储加密措施？ （例如：AES256；云服务的KMS；其他存储加密机制）"
  },
  {
    "stableKey": "tpa_050",
    "section": "",
    "sequence": "4",
    "title": "第三方所提供的产品/服务，是否确保数据不会被篡改、截取/窃取、或丢失？"
  },
  {
    "stableKey": "tpa_051",
    "section": "",
    "sequence": "5",
    "title": "第三方有哪些数据安全机制，确保不会泄露或非授权访问我方传输的数据？"
  },
  {
    "stableKey": "tpa_052",
    "section": "",
    "sequence": "6",
    "title": "第三方是否对人员设备（如笔记本电脑等）实施安全措施，包括：防病毒软件、硬盘加密、数据防泄漏软件（DLP）等"
  },
  {
    "stableKey": "tpa_055",
    "section": "",
    "sequence": "1",
    "title": "第三方是否遵循如下隐私保护相关的法律法规和条款？ 1）中国产品服务： 《个人信息保护法》；《数据安全法》、《网络安全法》 2）海外产品服务： • 美国：California Consumer Privacy Act (CCPA)；Health Insurance Portability and Accountability Act (HIPAA)；Children’s Online Privacy Protection Act (COPPA) • 欧盟：General Data Protection Regulation (GDPR) • 日本：Act on the Protection of Personal Information（APPI） • 印度：Personal Data Protection Bill 请在”补充信息“列具体说明"
  },
  {
    "stableKey": "tpa_056",
    "section": "",
    "sequence": "2",
    "title": "第三方产品/服务是否从我方获取/收到任何用户的个人信息和内容数据？包括： 1）任何个人信息； 2）任何内容数据（音频流/视频流/文字消息/图片消息等） 3）任何客户资料； 4）任何声网的业务或技术材料数据、文档等"
  },
  {
    "stableKey": "tpa_057",
    "section": "",
    "sequence": "3",
    "title": "第三方产品/服务从声网，获取了哪些个人信息和内容数据？ 请列举所有的数据类型/字段，包括： 1）哪些用户个人信息字段； 2）哪些用户的内容数据（音频流/视频流/文字消息/图片消息等） 3）哪些客户资料； 4）哪些声网的业务或技术材料数据、文档等"
  },
  {
    "stableKey": "tpa_058",
    "section": "",
    "sequence": "4",
    "title": "第三方产品/服务对所获取的数据开展哪些数据处理活动？ （包括：第三方对我方数据的审核查看、数据分析、数据训练等）"
  },
  {
    "stableKey": "tpa_059",
    "section": "",
    "sequence": "5",
    "title": "我方是否能拒绝或退出，第三方产品/服务我方数据的审核查看、数据分析、数据训练等？ 具体如何实现拒绝或退出功能？请具体阐述或说明"
  },
  {
    "stableKey": "tpa_060",
    "section": "",
    "sequence": "6",
    "title": "如果第三方产品/服务存储我方提供的个人信息或内容数据，第三方会将数据存储在什么国家/区域？是否存储在中国境内?"
  },
  {
    "stableKey": "tpa_061",
    "section": "",
    "sequence": "7",
    "title": "如果第三方产品/服务存储我方提供的个人信息或内容数据，第三方将留存数据多久时间？ 请具体解释说明。"
  },
  {
    "stableKey": "tpa_062",
    "section": "",
    "sequence": "8",
    "title": "第三方是否能向我方提供数据删除的机制/功能？或遵循声网要求，对所获取的数据进行删除？ 请简述如何实现？"
  },
  {
    "stableKey": "tpa_063",
    "section": "",
    "sequence": "9",
    "title": "第三方是否限制将个人信息和内容数据跨境传输到第三国家？ （包括：通过物理传输；通过数据接口传输；或跨境访问、获取、下载、处理分析数据）"
  },
  {
    "stableKey": "tpa_064",
    "section": "",
    "sequence": "10",
    "title": "第三方是否已与声网签署服务合同，并签署了数据处理协议（DPA）？"
  },
  {
    "stableKey": "tpa_065",
    "section": "",
    "sequence": "11",
    "title": "第三方是否限制使用数据子处理者/分包商？"
  },
  {
    "stableKey": "tpa_066",
    "section": "",
    "sequence": "12",
    "title": "如果由于第三方的原因，发生个人信息或客户数据泄露，能否确保在事发后的24小时内上报声网；并紧急协助声网处理应对事件？"
  },
  {
    "stableKey": "tpa_067",
    "section": "",
    "sequence": "13",
    "title": "如果第三方向我方提供人工智能AI产品或服务，是否不会默认使用我们的数据来训练AI工具/模型？ (以避免我们的数据被导入任何公共AI训练数据库)"
  },
  {
    "stableKey": "tpa_068",
    "section": "",
    "sequence": "14",
    "title": "如果上一个问题是回答是“否”（即：会默认训练我方数据） 则第三方是否提供了便捷的退出AI学习/数据训练的选项?"
  },
  {
    "stableKey": "tpa_069",
    "section": "",
    "sequence": "15",
    "title": "如果第三方向我方提供人工智能AI产品或服务，是否不会默认对我们提供的数据开展内容审核/查看/访问?"
  },
  {
    "stableKey": "tpa_070",
    "section": "",
    "sequence": "16",
    "title": "如果上一个问题是回答是“否”（即：会默认对我方数据进行内容审核/查看/访问） 则第三方是否提供了便捷的退出/拒绝内容审核选项?"
  },
  {
    "stableKey": "tpa_071",
    "section": "",
    "sequence": "17",
    "title": "如果第三方向我方提供人工智能AI产品或服务，是否仅对数据进行实时处理，而不会落盘存储数据？ （或是否在处理后即刻删除我方数据）"
  },
  {
    "stableKey": "tpa_072",
    "section": "",
    "sequence": "18",
    "title": "如果第三方向我方提供人工智能AI产品或服务，是否已获得中国监管（如网信办）的算法备案证明？ 请提供备案佐证材料"
  }
];
