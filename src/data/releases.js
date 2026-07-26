import { lyricTextByTitle } from './lyrics.js';

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
        releaseDate: '2026',
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
    }),
    makeRelease({
        title: '媚人 - Single',
        type: 'single',
        releaseDate: '2026-07-17',
        sourceArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/6c/c8/3a/6cc83adf-7cd1-8dd0-6606-94106ac1f83f/4896016816485.jpg/600x600bb.jpg',
        coverOssUrl: '',
        palette: { a: [111, 45, 43], b: [188, 190, 186] },
        tracks: [
            makeTrack('媚人', {
                musicOssUrl: 'https://yuko-vinyl.oss-cn-hangzhou.aliyuncs.com/musics/%E5%AA%9A%E4%BA%BA.mp3',
                trackNumber: 1,
                artist: '薛之谦'
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

export const getTrackKey = (releaseTitle, track) => [
  releaseTitle,
  track.trackNumber,
  track.title
].join('\0');

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
