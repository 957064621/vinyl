const COVER_BASE_URL = 'https://yuko-portfolio.oss-cn-hangzhou.aliyuncs.com/cover/';
const MUSIC_BASE_URL = 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/';

const COVER_ROTATION_FILES = [
    '3.jpg',
    '4.jpg',
    '1.jpg',
    '2.jpg',
    '%E5%A4%A9%E5%A4%96%E6%9D%A5%E7%89%A9.jpg'
];
const getMusicOssUrlByTitle = (title) => {
    const cleanTitle = cleanTrackTitle(title);
    return `${MUSIC_BASE_URL}${encodeURIComponent(getMusicFileName(cleanTitle))}`;
};


const lyricTextByTitle = {
    '天外来物': '你就像天外来物一样\n求之不得\n我在世俗里的名字\n被人用了\n反正我隐藏的人格\n是锲而不舍',
    '演员': '该配合你演出的我\n尽力在表演\n像情感节目里的嘉宾\n任人挑选\n如果还能看出我有\n爱你的那面',
    '丑八怪': '丑八怪\n能否别把灯打开\n我要的爱\n出没在漆黑一片的舞台\n丑八怪\n在这暧昧的时代',
    '刚刚好': '我们的爱情\n到这刚刚好\n剩不多也不少\n还能忘掉\n我应该可以\n把自己照顾好',
    '认真的雪': '雪下得那么深\n下得那么认真\n倒映出我躺在雪中的伤痕\n爱得那么认真\n爱得那么深',
    '绅士': '我想摸你的头发\n只是简单的试探啊\n我想给你个拥抱\n像以前一样可以吗\n你退半步的动作\n认真的吗',
    '动物世界': '人类用沙\n想捏出梦里通天塔\n为贪念不惜代价\n驾驭着昂贵的木马\n巢穴一层层叠加',
    '方圆几里': '我宁愿留在你方圆几里\n我的心要不回就送你\n因为我爱你\n和你没关系',
    '守村人': '你看守村的夜景\n灯忽明忽暗\n最爱你的人\n望眼欲穿\n烟花点不燃\n我没像样的伞',
    '租购': '能给她一个\n不管多久都不会变动的家\n收容所有的流浪\n不让她觉得害怕',
    'Nothing': 'I am still waiting\nfor you\nI am still waiting\nfor nothing\nCome back to me',
    '崇拜': '我崇拜\n你回眸一笑就万里火海\n能明白\n我孤独的存在',
    '情书': '甘愿签下唯一\n终生制承诺书\n受益名字\n是你也是我的全部\n哪怕非得孤注一掷\n也不愿再辜负一次',
    '顽疾': '病历上肆意拉锯\n来回写满\n摊开给你欣赏\n我的不堪\n可是要治好顽疾\n有多难',
    '人字拖': '我还记得\n你离开的末班车 是蓝色的\n造梦的人逃离拥挤的巷弄\n我像路人普通\n灯牌的背后都是苦涩',
    '湖泊': '让我睡着在湖泊 湖泊 湖泊 湖泊\n把身体交给湖泊 湖泊 湖泊 湖泊\n放任那浑浊抚摸抚摸我\n既无能挣脱，那只能沉默\n生于湖泊里，死于湖泊里\n善于湖泊里，恶于湖泊里',
    '跃': '是那沉没的舰\n是那无尽的夜\n是那盏灯塔在忽明忽灭\n我时而跃出海面，我时而脸抚深渊\n总感觉一切无际无边又在鱼缸里面',
    '金斧子银斧子': '你掉的是金斧还是银斧\n你爱的是真人还是假人\n你惹的是金角还是银角\n你赚的是真钱还是假钱\n上述带刺，恕不译字\n特来肇事，让群儒鄙视',
    '平庸': '我要用暗淡盖你璀璨的伤\n别回答\n让烟慢慢烫\n烫一个洞\n留一点念想',
    '爱我的人谢谢你': '每一次掌声响起\n多少爱沸腾在你手里\n告诉自己千万不可以对不起你\n唱一首爱的歌曲\n爱我的人我真的谢谢你',
    '爱我的人 谢谢你': '每一次掌声响起\n多少爱沸腾在你手里\n告诉自己千万不可以对不起你\n唱一首爱的歌曲\n爱我的人我真的谢谢你',
    '木偶人': '所以当我们都变成木偶人\n你何苦再做一个痴情人表忠贞\n文字叙述工整重复廉价伤痕\n你还会哭多感人',
    '慢半拍': '我们模仿 慢半拍的 芭比\n我们移动 慢半拍的 身体\n漫天纸醉金迷 这算不上滑稽\n反正这世界早已那么差强人意',
    '我害怕': '我害怕你的消息\n不经意被谁提起\n像曾贴着我耳边的气息\n我害怕某个旋律\n带我回某个场景\n你说如果雨停了我们就在一起',
    '霸王别姬': '当湖面澄清 笑可倾城\n是谁不懂珍惜\n当美景恍惚 映入铜镜\n是我对你不起\n落得 霸王别姬',
    '聊表心意': '我怎么那么爱你\n我还是抵抗不了你的声音\n我必须控制自己 别疯狂的找你',
    '迟迟': '耳朵先撒了谎 是你靠近的声响\n来探我梳妆的模样 我着白纱登场\n和你希望的一样 我走的很慢\n像你在对面一样',
    '我的雅典娜': '雅典娜 我以神的名义\n赐给你爱我的心\n你只能爱我 这不是传说\n你无法逃脱\n我愿意 为你化身成魔',
    '粉钻': '满地粉钻 无人看管\n你若不甘 用爱交换\n漫天红伞 无人生还\n我的遗憾 是不能洁白的带你离开',
    '其实': '分开后我会笑着说\n当朋友问你关于我\n我都会轻描淡写仿佛没爱过\n其实我根本没人说\n其实我没你不能活\n其实我给你的爱比你想的多',
    '像风一样': '你像风一样\n吹过我的身旁\n留下了一地\n我无法收拾的慌张',
    '那是你离开了北京的生活': '我以为是规则 失去最爱的一个\n才能记忆深刻\n那些幼稚的 轻狂的 勇敢的 从此收着\n我还在羡慕什么 街上哭的那个\n你却无比希望他抱住另一个\n那是你离开了北京的生活',
    '违背的青春': '我违背的青春\n在拥挤的人潮中\n我违背的青春\n在无处安放的岁月里\n我违背的青春',
    '你还要我怎样': '你还要我怎样 要怎样\n你突然来的短信就够我悲伤\n我没能力遗忘 你不用提醒我\n哪怕结局就这样',
    '王子归来': '求你睁开双眼 看看千军万马\n他穿着你最爱的盔甲\n童话故事里都很美\n可躺在王子怀里的公主\n真的很美',
    '红尘女子': '关上房门别问我在思念谁\n公子羡慕你天生富贵\n不用管名利是非\n红尘女子\n没人懂得你的美',
    '爱不走': '爱充满了天空\n爱弥漫在风中\n爱把我带到你的身后\n爱在我的左右\n爱不走',
    '快乐帮': '没有谁生来就该寂寞该忧伤\n要快乐 要去分享\n快乐帮 快乐帮\n我们一直在你身旁',
    '我的Show': '我开开心心表演我的show\n你们懂不懂\n我要我自己的天空\n我认认真真追求我的梦\n你们懂不懂',
    '黄色枫叶': '你摘下黄色枫叶\n证明我在秋天离开\n我答应你会回来\n当黄色枫叶再开成海\n我就会回来',
    '钗头凤': '我唱着钗头凤\n看世间风月几多重\n我打碎玉玲珑\n相见别离都太匆匆',
    'Memory': '事到如今已过了这么多年\n我还是无法忘记\n分手的那天天空飘下雪\n我们的爱早已幻灭\n只剩Memory',
    '苏黎世的从前': '我把那封信留在 苏黎世的从前\n你打开铁柜发现我的思念开始蔓延\n你坚持不哭的脸\n我却总是想念',
    '你过得好吗': '你过得好吗\n你过得好吗\n会想起我吗\n曾经的辛苦 还历历在目\n你受伤了吗',
    '爱情宣判': '我爱你 你爱他\n残酷的答案\n会有人来把我的角色演完\n忍住了 你没说 是我不配',
    '爱的期限': '你曾问我 爱的期限\n我回答说是一万年\n原来只是 电影画面\n我给你的爱\n期限是一万年',
    '朋友你们还好吗': '朋友你们还好吗 是否仍然那么傻\n偶尔给我打个电话听我的冷笑话\n朋友你们还好吗 像过去那么潇洒\n走到哪里都会有家',
    '马戏小丑': '天又快要亮了 我又该起床了\n又要没饭吃了 眼眶又要湿了\n这值不值得 这值不值得',
    '倾城': '你的长发流水落花你的脸颊\n满城风沙 为了你谁扔了天下\n遇见了你却放不下\n只为一个你 倾城',
    '丢手绢': '丢丢丢手绢\n把它放在你的口袋\n你却始终没打开\n丢丢丢手绢\n可你始终看不见',
    '续雪': '雪下得那么深\n你会否听得很认真\n全世界的离人都哼着我的心疼\n雪下得那么深 北京冬天的黄昏',
    '传说': '浪如山雨如针都随风起\n海的尽头住着你\n千年后会有人从传说里\n借月光将思念看清',
    '深深爱过你(前世)': '请记得 我曾深深的爱过你\n曾 深信不移\n就算有风 就算有雨\n就算他们都不同意\n请记得 我会深深的爱着你',
    'Let You Go': 'Let you go\nlet you go\nlet you go\n你强还我自由\n为我划地为囚\n我怎样去挽留',
    '给我的爱人': '可惜吗 我的爱人啊\n你在哪 花都开满了啊\n你累吗 你走多远了啊\n我哭了啊 我的爱人啊',
    '我们的世界': '我要回到从前的世界\n我想要回到认识你那一天\n把我们的故事 一页页重新看一遍\n请让我回到我们的世界',
    '流星的眼泪': '啊 流星的眼泪 在雨中流散\n要陪你走完\n你舞最后一段 我为你撑伞\n啊 是我的眼泪 在雨中纷飞',
    '星河之役': '星河的战役 为我的爱\n要全力出击\n王子发出攻击的号令\n星河的士兵 都万众一心',
    '深深爱过你(今生)': '请记得我曾深深的爱过你\n曾 深信不移\n就算有风 就算有雨\n就算他们都不同意\n请记得我会深深的爱着你',
    '梦开始的原点': '就让我的心回到 梦开始的原点\n有多少白天黑夜\n忍着眼泪流着汗水\n我坚持走到今天',
    '未完成的歌': '你是我今生未完成的歌\n唱不到结局却又难以割舍\n看你侧脸的轮廓 在灯火中隐没\n你是我唱到喉咙沙哑 未完成的歌',
    '我知道你都知道': '我知道 你全都知道\n保持沉默\n你不想太计较\n你看着我\n就一个微笑 让借口变成煎熬',
    '几个你': '我还要遇见几个你 才可以忘记你\n我还要拒绝几个你 才可以不想起\n这城市怎么都是你 可你在哪里\n原来你住在我心里',
    '伏笔': '奋不顾身到全身而退\n谁只为感情一点余味\n谁不是唱过细水长流最后变卑微\n回头发现只是不甘寂寞的面对',
    '为什么': '为什么 我们回不去了\n为什么 都回不去了\n为什么 小时候的快乐时光都回不去\n请还我一个 真的世界',
    '我终于成了别人的女人': '我终于成了别人的女人\n曾经为你奋不顾身的人\n只为你偶尔的温柔 越走越深\n等到最后无路可退的人',
    '敷衍': '好吧我是个敷衍\n但敷衍很爱你 你何时才能听得见\n我愿做个敷衍 只是你的敷衍\n你何时才能听得见',
    '我们爱过就好': '我们爱过就好 爱了 散掉\n这不会有结局 你我都知道\n就让我们说好 一起 忘掉\n我怕爱到最深的地方 我不可原谅',
    '楚河汉界': '你的军队过界\n想只手遮天\n碰触我底线\n军令放左手边\n宣誓要将你歼灭',
    '为了遇见你': '为了遇见你 我珍惜自己\n我穿越风和雨 只为交出我的心\n直到遇见你 我相信了命运\n这未来值得去努力 为你',
    '意外': '明知这是一场意外\n你要不要来\n明知这是一场重伤害\n你会不会来\n当疯狂慢慢从爱情离开\n还有什么 值得感慨',
    '有没有': '有没有人比你懂我的防备\n还是会笑我傻到以为\n这真心的话不能给\n多残忍也都自己安慰\n有没有人比我更惭愧',
    '潮流季': '原来潮流是一场换季\n最美抵不过一季限期\n拥有接受失去的勇气\n才值得幸运\n也许流行是一种光景\n还在褪去时意犹未尽',
    '等我回家': '我不想\n辜负一次又一次的信任\n这世界太嘈杂\n周边都是假话\n你能不能再找个理由\n等我回家',
    '我想起你了': '风雨到平淡仿佛没来过\n我想起你了\n爱情不过是\n一把伞下的争吵\n爱情不过是\n你陪我闹',
    '方圆几里 (吉他版)': '我宁愿 留在你方圆几里\n我的心 要不回就送你\n因为我爱你 和你没关系',
    '初学者': '围观的 自愿的 做崇拜者\n贪婪的 欺骗着 初学者\n劝说者 自私的 做挑拨者\n认真的 初学者 你不及格',
    '我好像在哪见过你': '我听见了你的声音\n也藏着颗不敢见的心\n我躲进挑剔的人群\n夜一深就找那颗星星\n我好像在哪见过你',
    '一半': '我毁了艘小船 逼我们隔着岸\n冷眼旁观 最后一段 对白还有点烂\n是我投入到一半 感到不安\n好过未来一点一点纠缠',
    '小孩': '你就对我说明白\n就让我看明白\n从什么时候我像小孩\n我的天台从来热爱\n不需要猜 别让我猜',
    'Stay Here': 'Stay Here\nI want you\nstay with me\n用尽最后的空气\nStay Here\nI want you stay',
    '花儿和少年': '那过去的 花儿和少年\n隔着青春和我 正面背面\n笑我庸俗肤浅 一脸不屑\n有故事的 花儿和少年',
    '下雨了': '雨还在下你听得见吗\n是我的思念滴滴答答\n滴入你的心就会想起我\n雨还在下像在寻你\n这样的季节就会特别想你',
    '暧昧': '反正现在的感情 都暧昧\n你大可不必为难 找般配\n付出过的人排队 谈体会\n趁年轻别害怕一个人睡\n可能是现在感情 太昂贵\n让付出真心的人 好狼狈',
    '高尚': '我多高尚 向自尊开了枪\n你同情的眼光 我特别的欣赏\n哀而不伤\n我多慌张 怕人闯入我围墙\n窥探五官不详 见我原本模样',
    '骆驼': '转眼就看见沙漠\n那里有没有骆驼\n明明就来到沙漠\n为何看不到骆驼\n是不是你 不说话 不说话',
    '别': '别让他听见你最后一句\n别坦白 别让故事精彩\n别不安 只是还有习惯\n别喜欢 我长期的勇敢\n别揭穿 我唯一的遗憾',
    '火星人来过': '火星人来过\n火星人来过\n火星人救我\n火星人救我',
    '背过手': '无奈的请背过手\n在缝里等野果成熟\n无辜的人松了手\n反正那背负都雷同',
    '渡': '渡人去的夜 用稀有的火焰\n照亮了胆怯 燃尽我语言\n亏欠都是磁铁 也不能被降解\n都想赎去罪孽 再偷偷的怀念',
    '摩天大楼': '摩天大楼 太稀有\n人人高贵富有 表情温柔 怕献丑\n摩天大楼 云里走\n谢绝衣衫简陋 粉饰骷髅',
    '怪咖': '你的改变 很难制止了\n我的取悦 也不是天生的\n熟练了 喜怒就合并了\n感情里的怪咖 有铺垫就不尴尬',
    '肆无忌惮': '你肆无忌惮 你急着闹翻\n用词刁钻 要观后感\n爱本是两端 要倾斜不难\n要摧毁简单\n我违背自然 我表演勇敢',
    '狐狸': '前提是你要先感受到一丝恶意\n具体 请闯入我森林\n建议是你别再玩弄那些小把戏\n当猎枪响起 看看谁在回避',
    '天份': '我有点疼 但是我还能忍\n是不是爱你我算还有点天份\n话要适可而止 挽留的举止\n可是谁没有一次不顾一切的坚持',
    '最好': '最好就这样能把你忘掉\n最好能不想还有多困扰\n这复杂的情绪向我奔跑\n最好的都已经送你不要',
    '醒来 (Live)': '我疲倦的灵魂重演着\n我沧桑的肉体缝补了\n我梦境里追逐着什么\n醒来后哭着笑了\n醒来后继续活着',
    '哑巴': '我们都迁就嘴巴\n我们都憋着真话\n我们都让爱先发芽\n越退让越不会表达\n所有的安静都是人造的冷清',
    '这么久没见': '你去过的地方我都去过\n前后的故事大概听说\n你爱过的人我揣摩过\n在你喧闹的间隙 会不会想我\n好久不见 有点想念',
    '笑场': '我尚未开口你先笑场\n如同我脸上画了滑稽的妆\n这尴尬立即将我捆绑\n矫情的台词多了几行',
    '病态': '失重的时代坠落下来\n在末日的午后 百无聊赖\n斑驳的黑白 复制病态\n蒸发稀薄的爱\n直到倾斜的城市无法负载',
    '尘': '我是被你吸引的尘埃\n屋檐下最渺小的陪伴\n爱情不用精致的睡袋\n我是无能为力的尘埃\n辜负那些妖娆的期待',
    '陪你去流浪': '我看着湖面 平平淡淡\n好像还有艘小船 安安静静\n你掀起远方 漪涟海浪\n我可以陪你去流浪',
    '配合': '既妖魔化 又何惧真假\n法外无它 我配合你一下\n面具下 谁也都伟大\n夺我白马 赐我利爪',
    '环': '美若天仙 金山银山\n依旧只能饱览寂寞景观\n填不满大海 喂不饱深渊\n摘不到月亮的人说肝肠寸断',
    '把你揉碎捏成苹果': '把你揉碎捏成苹果 毒死我\n我还被你的双手反锁\n还没轮到我 你解脱了下一个\n不断去拉扯 多痛不嫌多',
    '野心': '欢迎你误入这片狼藉的森林\n规则是为了片净土而去拼命\n用纯白的纱 遮住扭捏的野心\n我望着你 不肯后退的眼睛',
    '彩券': '在我遇见你以前\n也拥有过完整的睡眠\n我中过最惊喜的彩券\n就是在那天我进了那间\n便利店',
    '不爱我': '我听过 你爱不爱你爱 不爱我\n我问过 你要不要你要 不要我\n我试过 好说歹说都不再会有效果\n原来你 不爱我',
    '潘金莲': '留一扇难掩的门\n赊余生换一个亲吻\n我愿意出卖的灵魂\n比你的目光还要冰冷\n每滴血都见证我生存',
    '耗尽': '我们要不回理想 还耗尽了归途的光\n一直到 寻你的姑娘认不出了你的模样\n借巨塔许愿望 攒违心的鼓掌\n请迷恋我 一身假象',
    '纸船': '像月亮在弯弯的笑着\n惋惜灯塔在海浪里碎了\n我把隔绝我们的称作银河 全是蓝色\n像海底建起了护城河',
    '无数': '在人们无数次沉没里\n怎么还有条船不远万里\n它带着幼稚的真理\n还背负着勇敢的罪名\n在我无数次失败里\n你凭什么陪我颠沛流离',
    '凤毛麟角': '斩下我身上的凤毛麟角\n炼成广告里的灵丹妙药\n感谢我付出的辛苦勤劳\n然后把我打回黑漆漆的牢\n我不是待宰的羊羔 有尖牙 有利爪',
    '变废为宝': '我希望 有一天我会长出翅膀\n遨游在浩瀚宇宙的海洋\n不用氧 只靠光\n我多么希望 世界上不会再有争吵',
    '你不是一个人': '你不是一个人\n你不用一个人\n我说的很大声 忽略了路人 在等你转身\n我不在意别人\n我只需要你确认',
    '可': '分又不可 离也难舍\n可我还要生活\n你应该放过我\n总有人来爱我\n总比现在好过',
    '男二号': '所以我特别重要\n为你 演绎男二号\n不主动别计较 等你为情困扰 会来找\n我到第几集 目送你和好',
    '守候': '还要我等多久\n见到你的笑容\n你在哪里追求\n是否已经拥有\n你离开的出口 变成我的缺口',
    '守候 (2020重唱版)': '还要我等多久\n见到你的笑容\n你在哪里追求\n是否已经拥有\n你离开的出口 变成我的缺口',
    '洛城': '我策马错过 洛城里的花香\n那千古恨意 谁在轻唱\n我收到的信 已不见你字样\n求万人阻挡 我的疯狂',
    '被人': '我们都不擅长被人\n闯入心里上锁的门\n然后开始用躯壳硬撑\n全世界只有你知道我在骗人',
    '关于你': '我想告诉你 我写过很多信\n拙劣的字迹无处投递\n几万笔 最后连文字都不像你\n我想梦见你 可你没回应',
    '银河少年': '我想我可以拯救世界\n我是来自银河的少年\n怎么这儿神佛已满天\n却全是一片 无助的笑脸\n被规则毁灭 也不曾妥协的 信念',
    'AI': '失去你以来 万物在摇摆\n你指的山海 像玩具一块一块\n我是你缔造又堤防的AI\n如果我存在 是某种伤害\n不被你所爱 也不能具象出来',
    '解解闷': '你千万别当真\n我没让你几分\n你先超越别人\n再陪我解解闷\n我不是不认真 你承又不承认',
    '在那天回不去的路上': '我还等着我 我还没有醉\n我还记得我 多么多么美\n我拼凑着我 来时的无畏\n后果 后果\n都是醉前搬弄的是非',
    '念': '我算不算鲜艳\n残枝深埋勿见\n请用凡胎肉眼\n笑我这半生放下的尊严\n我愿被乱世拆解你不必随我捐献',
    '造物': '唾弃你贪婪的咒\n现在又何必挽留\n怎么狂妄到 要灵魂任人左右\n莫非造了我 爱造了祸\n你才不会觉得寂寞',
    '来日方长': '总是妄想\n借半生流离\n换某人怜悯\n我说爱\n或许是来日方长的事情\n等不到人也至少盼着自己',
    '小尖尖': '在霓虹雨里面\n伞里都是恩怨\n我口袋只剩玫瑰一片\n此行又山高路远\n问私奔多少年\n能舍弃这世界',
};

;

;

const cleanTrackTitle = (title) => String(title)
    .replace(/\s*\(《.*?》.*?\)$/u, '')
    .trim();

const normalizeTitleKey = (title) => cleanTrackTitle(title).replace(/\s+/g, '');

const getMusicFileName = (title) => `${cleanTrackTitle(title)}.mp3`;

const makeSongLabel = (title) => `《${cleanTrackTitle(title)}》`;

const makePlaceholderLyric = (title) => `${cleanTrackTitle(title)}\n歌词待补充`;

const artistByTitle = {
    '小尖尖': '薛之谦 / 韩红',
    '来日方长': '薛之谦 / 黄龄'
};

const makeTrack = (title, extra = {}) => {
    const cleanTitle = cleanTrackTitle(title);
    const text = Object.prototype.hasOwnProperty.call(lyricTextByTitle, cleanTitle) ? lyricTextByTitle[cleanTitle] : makePlaceholderLyric(cleanTitle);
    const musicFileName = getMusicFileName(cleanTitle);

    return {
        song: makeSongLabel(cleanTitle),
        title: cleanTitle,
        text,
        needsLyric: !Object.prototype.hasOwnProperty.call(lyricTextByTitle, cleanTitle),
        musicFileName,
        musicOssUrl: getMusicOssUrlByTitle(cleanTitle),
        artist: artistByTitle[cleanTitle],
        ...extra
    };
};

const makeTracks = (titles) => titles.map((title, index) => makeTrack(title, { trackNumber: index + 1 }));

const makeRelease = ({
    title,
    type,
    releaseDate,
    sourceArtworkUrl = '',
    coverOssUrl = '',
    palette,
    tracks
}) => ({
    title,
    type,
    releaseDate,
    sourceArtworkUrl,
    coverOssUrl,
    palette,
    tracks
});

const releases = [
    makeRelease({
        title: '薛之谦',
        type: 'album',
        releaseDate: '2006-06-09',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/7a/a1/957aa172-9511-69d4-9d2f-b6179cb761f9/6942219354632.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [211, 76, 64], b: [235, 151, 86] },
        tracks: makeTracks([
            '王子归来',
            '认真的雪',
            '红尘女子',
            '爱不走',
            '快乐帮',
            '我的Show',
            '黄色枫叶',
            '钗头凤',
            'Memory',

        ])
    }),
    makeRelease({
        title: '你过得好吗',
        type: 'album',
        releaseDate: '2007-07-31',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/4e/b5/f4/4eb5f40f-92f5-a5f7-ddab-011d62979216/6942219354915.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [198, 150, 91], b: [93, 91, 76] },
        tracks: makeTracks([
            '苏黎世的从前',
            '你过得好吗',
            '爱情宣判',
            '爱的期限',
            '朋友你们还好吗',
            '马戏小丑',
            '倾城',
            '丢手绢',
            '续雪',

        ])
    }),
    makeRelease({
        title: '深深爱过你',
        type: 'album',
        releaseDate: '2008-11-26',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c9/b6/b9/c9b6b996-1cea-6536-5144-07294fb2ee0c/6942219354922.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [126, 48, 57], b: [217, 160, 102] },
        tracks: makeTracks([
            '传说',
            '深深爱过你(前世)',
            'Let You Go',
            '给我的爱人',
            '我们的世界',
            '流星的眼泪',
            '星河之役',
            '深深爱过你(今生)',
            '梦开始的原点'
        ])
    }),
    makeRelease({
        title: '未完成的歌',
        type: 'album',
        releaseDate: '2009-12-11',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/17/81/83/1781831d-41c8-e4d4-ae2d-85ae78c9b90e/4894972500721.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [68, 59, 55], b: [196, 164, 128] },
        tracks: makeTracks([
            '未完成的歌',
            '我的雅典娜',
            '传说',
            '马戏小丑',
            '你过得好吗',
            '红尘女子',
            'Memory',
            '倾城',
            '我们的世界',
            '给我的爱人',
            '爱的期限',
            '黄色枫叶',
            '认真的雪',
            '爱我的人 谢谢你'
        ])
    }),
    makeRelease({
        title: '几个薛之谦',
        type: 'album',
        releaseDate: '2012-08-15',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/38/62/86/386286fe-9d93-fb3b-92e1-902d754f6d83/4894972916164.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [76, 76, 92], b: [190, 178, 168] },
        tracks: makeTracks([
            '我知道你都知道 (《胜女的代价》电视剧插曲)',
            '几个你',
            '伏笔',
            '为什么',
            '我终于成了别人的女人',
            '敷衍',
            '我们爱过就好 (《音乐江湖》电影主题曲)',
            '楚河汉界',
            '为了遇见你 (《胜女的代价》电视剧插曲)'
        ])
    }),
    makeRelease({
        title: '意外',
        type: 'album',
        releaseDate: '2013-11-11',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/40/2c/54/402c5424-5c68-a0b7-d56f-90b5d810c1f9/9787798504262.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [146, 99, 70], b: [218, 180, 136] },
        tracks: makeTracks([
            '丑八怪',
            '意外',
            '你还要我怎样',
            '有没有',
            '潮流季',
            '等我回家',
            '我想起你了',
            '其实',
            '方圆几里',
            '方圆几里 (吉他版)'
        ])
    }),
    makeRelease({
        title: '初学者',
        type: 'album',
        releaseDate: '2016-07-18',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b0/09/04/b009043f-f576-54ce-5b1f-d7896d6933c0/9555150772273.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [205, 64, 72], b: [244, 170, 150] },
        tracks: makeTracks([
            '初学者',
            '刚刚好',
            '我好像在哪见过你',
            '演员',
            '绅士',
            '一半',
            '小孩',
            'Stay Here',
            '花儿和少年',
            '下雨了'
        ])
    }),
    makeRelease({
        title: '渡 The Crossing',
        type: 'album',
        releaseDate: '2017-11-28',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/5a/9a/71/5a9a718c-5a62-5ad3-cede-ab37eeb8d419/9555150715829.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [112, 176, 220], b: [224, 181, 116] },
        tracks: makeTracks([
            '动物世界',
            '暧昧',
            '像风一样',
            '高尚',
            '骆驼',
            '别',
            '火星人来过',
            '背过手',
            '渡',
            '我害怕'
        ])
    }),
    makeRelease({
        title: '怪咖',
        type: 'album',
        releaseDate: '2018-12-31',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0d/e3/b1/0de3b130-94dc-6df0-2601-14cdb3238d55/9555150726139.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [50, 101, 128], b: [208, 93, 112] },
        tracks: makeTracks([
            '摩天大楼',
            '怪咖',
            '肆无忌惮',
            '狐狸',
            '天份',
            '最好',
            '醒来 (Live)',
            '哑巴',
            '那是你离开了北京的生活',
            '违背的青春'
        ])
    }),
    makeRelease({
        title: '尘',
        type: 'album',
        releaseDate: '2019-12-27',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/83/26/77/8326773a-b470-4f92-e314-7428a66a61e4/6971928842864.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [124, 132, 140], b: [218, 209, 194] },
        tracks: makeTracks([
            '木偶人',
            '慢半拍',
            '这么久没见',
            '笑场',
            '病态',
            '尘',
            '陪你去流浪',
            '配合',
            '环',
            '聊表心意'
        ])
    }),
    makeRelease({
        title: '天外来物',
        type: 'album',
        releaseDate: '2020-12-31',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/09/8c/a7/098ca759-9752-fe44-ca39-a58ea4fcf4b7/6941636700824.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [237, 99, 112], b: [99, 160, 229] },
        tracks: makeTracks([
            '天外来物',
            '迟迟',
            '把你揉碎捏成苹果',
            '野心',
            '彩券',
            '不爱我',
            '潘金莲',
            '耗尽',
            '纸船',
            '小尖尖'
        ])
    }),
    makeRelease({
        title: '无数',
        type: 'album',
        releaseDate: '2022-09-20',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/41/ff/13/41ff1324-6a7a-4f51-e832-ede33a85cd46/6941636752342.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [150, 201, 237], b: [190, 204, 235] },
        tracks: makeTracks([
            '无数',
            '凤毛麟角',
            '变废为宝',
            '你不是一个人',
            '可',
            '男二号',
            '守候',
            '洛城',
            '被人',
            '关于你'
        ])
    }),
    makeRelease({
        title: '守村人',
        type: 'album',
        releaseDate: '2024-11-22',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f6/a9/0d/f6a90ded-ee5b-94f3-1cba-376129a1668e/4894972505108.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [80, 142, 130], b: [226, 139, 82] },
        tracks: makeTracks([
            '守村人',
            '银河少年',
            'AI',
            'Nothing',
            '崇拜',
            '情书',
            '租购',
            '解解闷',
            '在那天回不去的路上',
            '念'
        ])
    }),
    makeRelease({
        title: '顽疾 - Single',
        type: 'single',
        releaseDate: '2026-04-10',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/21/e6/9d/21e69d4d-e817-c471-bc07-3a50f3063ce0/4896016243601.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [61, 95, 130], b: [204, 148, 96] },
        tracks: makeTracks(['顽疾'])
    }),
    makeRelease({
        title: '人字拖 - Single',
        type: 'single',
        releaseDate: '2026-04-30',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5b/4f/c1/5b4fc1b9-8755-a973-d4af-79256d84bdf6/4896016342731.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [207, 196, 168], b: [92, 104, 118] },
        tracks: makeTracks(['人字拖'])
    }),
    makeRelease({
        title: '湖泊 - Single',
        type: 'single',
        releaseDate: '2026-02-14',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/96/9c/4b/969c4b69-bd56-b0b5-5077-5d7a814c8198/4896016081395.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [83, 134, 154], b: [202, 196, 170] },
        tracks: makeTracks(['湖泊'])
    }),
    makeRelease({
        title: '跃 - Single',
        type: 'single',
        releaseDate: '2025-07-17',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/78/83/dd/7883dd59-6f04-9cc2-fc1a-046536807899/4896004119970.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [92, 122, 150], b: [215, 158, 108] },
        tracks: makeTracks(['跃'])
    }),
    makeRelease({
        title: '金斧子银斧子 - Single',
        type: 'single',
        releaseDate: '2025-08-05',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/da/f4/e8/daf4e8ef-2bce-4f30-c9d5-5cbbdf8aabbd/4896004154414.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [214, 163, 92], b: [116, 102, 86] },
        tracks: makeTracks(['金斧子银斧子'])
    }),
    makeRelease({
        title: '守候 (2020重唱版) - Single',
        type: 'single',
        releaseDate: '2020-08-21',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/82/d1/c1/82d1c107-b040-6b83-0439-e02ebe26c466/cover.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [205, 180, 142], b: [78, 90, 106] },
        tracks: makeTracks(['守候 (2020重唱版)'])
    }),
    makeRelease({
        title: '来日方长 - Single',
        type: 'single',
        releaseDate: '2016-09-12',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/56/69/bf/5669bf76-6868-4cb1-2831-d4b1c597030d/4894972422825.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [174, 76, 72], b: [224, 184, 112] },
        tracks: [
            makeTrack('来日方长', {
                artist: '薛之谦 / 黄龄',
                trackNumber: 1
            })
        ]
    }),
    makeRelease({
        title: '音乐缘计划2 第3期 (Live)',
        type: 'live',
        releaseDate: '2025-11-07',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/9b/a8/3a/9ba83a47-de41-1925-cd5b-6f86924a103b/4896004619340.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [93, 70, 112], b: [201, 147, 96] },
        tracks: makeTracks(['平庸'])
    }),
    makeRelease({
        title: '霸王别姬 - Single',
        type: 'single',
        releaseDate: '2025-09-20',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ad/04/c1/ad04c11c-47b0-3edc-e2c7-04dc0faca8f2/4896004431041.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [158, 35, 46], b: [226, 188, 112] },
        tracks: makeTracks(['霸王别姬'])
    }),
    makeRelease({
        title: '万兽之王演唱会录音',
        type: 'live-recording',
        releaseDate: '',
        sourceArtworkUrl: `${COVER_BASE_URL}1.jpg`,
        coverOssUrl: `${COVER_BASE_URL}1.jpg`,
        palette: { a: [150, 201, 237], b: [190, 204, 235] },
        tracks: [
            makeTrack('粉钻', {
                musicOssUrl: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/%E7%B2%89%E9%92%BB.mp3',
                trackNumber: 1,
                artist: '薛之谦',
                recordingSource: '万兽之王演唱会录音'
            }),
            makeTrack('造物', {
                musicOssUrl: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/%E9%80%A0%E7%89%A9.mp3',
                trackNumber: 2,
                artist: '薛之谦',
                recordingSource: '万兽之王演唱会录音'
            })
        ]
    })
];

const getReleaseSortTime = (release) => {
    const timestamp = release.releaseDate ? Date.parse(release.releaseDate) : Number.POSITIVE_INFINITY;
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
};

releases.sort((left, right) => {
    const timeDiff = getReleaseSortTime(left) - getReleaseSortTime(right);
    return timeDiff || left.title.localeCompare(right.title, 'zh-Hans-CN');
});

const albums = releases;

const lyricsPool = releases.flatMap((release) => release.tracks.map((track) => ({
    ...track,
    album: release.title,
    releaseType: release.type,
    releaseDate: release.releaseDate,
    sourceArtworkUrl: track.sourceArtworkUrl || release.sourceArtworkUrl,
    coverOssUrl: track.coverOssUrl || release.coverOssUrl,
    palette: track.palette || release.palette
})));

const VINYL_DATA = {
    COVER_BASE_URL,
    COVER_ROTATION_FILES,
    MUSIC_BASE_URL,
    releases,
    albums,
    lyricsPool
};

if (typeof window !== 'undefined') {
    window.VINYL_DATA = VINYL_DATA;
}

export {
    COVER_BASE_URL,
    COVER_ROTATION_FILES,
    MUSIC_BASE_URL,
    releases,
    albums,
    lyricsPool,
    VINYL_DATA
};
