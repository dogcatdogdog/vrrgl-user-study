/**
 * 界面语言（i18n）
 *
 * 由 `CONFIG.locale` 选择：'zh' | 'en' | 'auto'（auto = 按浏览器语言，中文环境用中文）。
 *
 * 只负责**界面字符串**。知情同意书正文在 `stimuli/consent.json` 里按语言分版本，
 * 因为它属于需要 IRB 审核的法律文本，不宜混在代码里。
 *
 * ⚠️ 中文翻译是开发方提供的初稿 —— 知情同意书尤其需要作者/伦理委员会确认后再用。
 */

const DICT = {
  en: {
    common: {
      continue: 'Continue',
      submit: 'Submit',
      finish: 'Finish',
      begin: 'Begin',
      startPractice: 'Start practice',
      download: 'Download my data (JSON)',
      yes: 'Yes',
      no: 'No',
    },

    entry: {
      title: 'Enter your study code',
      hint: 'Please enter the code the researcher sent you.',
      placeholder: 'e.g. R7K4M',
      submit: 'Start',
      needCode: 'You cannot start without a valid code. If you do not have one, please contact the researcher.',
      invalid: 'That code is not valid. Please check it and try again, or contact the researcher.',
      missingTable: 'The code list could not be loaded. The study is not deployed correctly — please contact the researcher.',
    },

    welcome: {
      title: 'Graph layout and readability',
      intro: 'In this session you will look at a series of network graphs and answer short questions about them. ' +
        'It takes about 45–50 minutes, and there are breaks.',
      note: 'There is no time limit on any question, and no penalty for wrong answers.',
      pidLabel: 'Participant ID',
      labHint: 'To start the next participant, close this tab and open a new one.',
      groupLab: 'lab',
      groupRemote: 'remote',
    },

    consent: {
      keyInfo: 'Key information',
      beforeStart: 'Before we start',
      statement: 'Statement of consent',
      mustTick: 'Please tick every box above to continue.',
      declined: 'You have declined to take part. Nothing has been recorded. You may close this window.',
      age: 'I am 18 years of age or older.',
      vision: 'I have normal or corrected-to-normal vision (glasses or contact lenses are fine).',
      colour: 'I have normal or corrected-to-normal colour vision.',
      desktop: 'I am completing this study on a desktop or laptop computer.',
      agreedRecorded: 'Consent recorded.',
    },

    demographics: {
      title: 'About you',
      age: 'Age',
      gender: 'Gender',
      genderF: 'Female',
      genderM: 'Male',
      genderO: 'Other',
      genderNA: 'Prefer not to say',
      field: 'Field of study / work',
      fieldCS: 'Computer science',
      fieldDS: 'Design',
      fieldOT: 'Other',
      fieldOther: 'If other, please specify (optional)',
      familiarity: 'How familiar are you with graph concepts such as nodes, links and degree?',
      familiarityLow: 'Not at all familiar',
      familiarityHigh: 'Very familiar',
      frequency: 'How often do you look at network/graph diagrams?',
      freqDaily: 'Daily',
      freqWeekly: 'Weekly',
      freqMonthly: 'Monthly',
      freqRarely: 'Rarely',
      freqNever: 'Never',
      needFamiliarity: 'Please rate your familiarity with graphs.',
    },

    instructions: {
      title: 'How to answer',
      t1Title: 'Finding neighbours',
      t1Text: 'One node is highlighted in blue. Click every node that is directly connected to it by a single line, then click Submit.',
      t1Hint: 'You can click nodes one by one to select or deselect them, or drag a rectangle on empty space to select several at once. Use the mouse wheel to zoom.',
      t4Title: 'Comparing connections',
      t4Text: 'Two nodes are highlighted in blue. Click the one you think is connected to more nodes. Your answer is recorded as soon as you click.',
      t2Title: 'Counting connections',
      t2Text: 'One node is highlighted in blue. Type how many nodes are directly connected to it, then click Submit.',
      example: 'Example',
    },

    trial: {
      t1Factual: 'Click on all nodes that are directly connected to the highlighted node.',
      t1Perceptual: "Circle the nodes that appear to belong to the highlighted node's neighborhood.",
      t4: 'Which of the highlighted nodes has more direct connections?',
      t2: 'How many nodes are directly connected to the highlighted node?',
      selectedNodes: 'Selected nodes',
      none: 'None',
      remove: 'Remove this node from the selection',
      selectAtLeastOne: 'Select at least one node to continue.',
      typeNumber: 'Please type a number first.',
      typeNumberPlaceholder: 'Number of neighbours',
      clickOneTarget: 'Click one of the two highlighted nodes.',
    },

    feedback: {
      t1: 'Correct answer: {n} neighbours. You found {found}, and selected {extra} extra. (Jaccard: {jaccard})',
      t4Correct: 'Correct.',
      t4Wrong: 'Not quite.',
      t4: '{verdict} One node has {hi} connections; the other has {lo}.',
      t2: 'The correct answer is {truth}. You answered {answer} (off by {error}).',
    },

    ease: {
      title: 'Question {n}',
      question: 'How easy was it to answer this question?',
      veryDifficult: 'Very difficult',
      veryEasy: 'Very easy',
      chooseValue: 'Please choose a value.',
    },

    tlx: {
      title: 'How demanding was the task?',
      hint: 'Rate each aspect from 0 (very low) to 100 (very high).',
      mental: 'Mental demand — How mentally demanding was the task?',
      physical: 'Physical demand — How physically demanding was the task?',
      temporal: 'Temporal demand — How hurried or rushed was the pace of the task?',
      performance: 'Performance — How successful were you in accomplishing what you were asked to do?',
      effort: 'Effort — How hard did you have to work to accomplish your level of performance?',
      frustration: 'Frustration — How insecure, discouraged, irritated, stressed and annoyed were you?',
      pairsTitle: 'Which of these two contributed more to your workload?',
      answerAllPairs: 'Please answer every comparison.',
    },

    attention: {
      title: 'Comprehension check',
      text: 'To confirm you are reading carefully, please type the word GRAPH in the box below.',
      empty: 'Please type something.',
    },

    breakdown: {
      title: 'Take a short break',
      body: 'You have completed {done} of {total} trials. Please rest your eyes for a moment.',
      skip: 'Continue now',
    },

    done: {
      title: 'Thank you — you have finished.',
      completionCode: 'Please copy this completion code back into Prolific:',
      pid: 'Participant ID: {pid}',
      trials: 'You completed {n} trials.',
      attention: 'Comprehension checks passed: {passed} / {total}.',
      collect: 'The researcher will collect this file. Your data are stored under a participant code.',
      remoteCollect: 'Please SEND this downloaded file back to the researcher. '
        + 'Your results are stored only in this browser — the researcher cannot see them otherwise.',
    },

    preference: {
      title: 'Which layout was easiest to read?',
      hint: 'During the study you saw the same graphs drawn in different ways. ' +
        'Please rank the four styles shown below from easiest (1) to hardest (4).',
      position: 'Position {pos}',
      posLeft: 'left',
      posMiddleLeft: 'middle-left',
      posMiddleRight: 'middle-right',
      posRight: 'right',
      useEachRank: 'Please use each rank (1–4) exactly once.',
    },

    literacy: {
      title: 'Quick graph-reading quiz',
      hint: 'There is no time limit, and you cannot fail this. Just do your best.',
      question: 'Question {n}',
    },

    errors: {
      title: 'Something went wrong',
      noData: 'Could not load the study data. Make sure you started a local web server ' +
        '(e.g. `python tools/serve.py`) rather than opening the file directly.',
      noPid: 'Missing participant ID.',
      noPidDetail: 'Open this page with a participant id, e.g. http://localhost:8000/src/?pid=P001\n' +
        'On Prolific this is filled in automatically.',
      alreadyDone: 'This participant id has already completed the study.\n' +
        'To run the next participant, open the page WITHOUT ?pid= (a new id is assigned automatically), ' +
        'or use a different ?pid=.',
      couldNotStart: 'Could not start the session.',
      configProblem: 'Configuration problem',
      unexpected: 'Unexpected error.',
      tooNarrowTitle: 'Your window is too narrow for this study.',
      tooNarrowBody: 'This study is designed for a desktop or laptop screen of at least {min}px wide ' +
        '(your window is {w}px).\n\nPlease maximise your browser window, turn off zoom, and reload this page. ' +
        'If you are on a phone or tablet, please do not continue — data from small screens cannot be used.',
      declinedTitle: 'Thank you.',
      screenedOutTitle: 'Thank you for your interest.',
      screenedOutBody: 'You did not meet the study requirements ({n} item(s)). Nothing has been recorded.',
      redirecting: 'Redirecting you back to Prolific…',
    },
  },

  zh: {
    common: {
      continue: '继续',
      submit: '提交',
      finish: '完成',
      begin: '开始',
      startPractice: '开始练习',
      download: '下载我的数据（JSON）',
      yes: '是',
      no: '否',
    },

    entry: {
      title: '输入实验编号',
      hint: '请输入研究者发给你的实验编号。',
      placeholder: '例如 R7K4M',
      submit: '开始',
      needCode: '没有有效编号无法开始实验。如果你没有编号，请联系研究者。',
      invalid: '编号无效，请检查后重试，或联系研究者。',
      missingTable: '无法加载编号表，部署不完整——请联系研究者。',
    },

    welcome: {
      title: '图布局与可读性',
      intro: '本次实验你会看到一系列网络图，并回答关于它们的简短问题。全程约 45–50 分钟，中间有休息。',
      note: '所有题目都没有时间限制，答错也不会扣分。',
      pidLabel: '被试编号',
      labHint: '开始下一位被试：关闭本标签页，再新开一个。',
      groupLab: '实验室',
      groupRemote: '远程',
    },

    consent: {
      keyInfo: '关键信息',
      beforeStart: '开始之前',
      statement: '同意声明',
      mustTick: '请勾选上方全部选项后才能继续。',
      declined: '你已选择不参加。本次没有记录任何数据，可以关闭这个窗口了。',
      age: '我已年满 18 周岁。',
      vision: '我的视力正常或已矫正（戴眼镜或隐形眼镜都可以）。',
      colour: '我的色觉正常或已矫正。',
      desktop: '我正在使用台式机或笔记本电脑完成本实验。',
      agreedRecorded: '已记录知情同意。',
    },

    demographics: {
      title: '关于你',
      age: '年龄',
      gender: '性别',
      genderF: '女',
      genderM: '男',
      genderO: '其他',
      genderNA: '不愿透露',
      field: '专业 / 工作领域',
      fieldCS: '计算机',
      fieldDS: '设计',
      fieldOT: '其他',
      fieldOther: '若选择「其他」，请说明（可选）',
      familiarity: '你对节点、边、度数这些图论概念有多熟悉？',
      familiarityLow: '完全不熟悉',
      familiarityHigh: '非常熟悉',
      frequency: '你平时看网络图 / 关系图的频率是？',
      freqDaily: '每天',
      freqWeekly: '每周',
      freqMonthly: '每月',
      freqRarely: '很少',
      freqNever: '从不',
      needFamiliarity: '请评价你对图的熟悉程度。',
    },

    instructions: {
      title: '如何作答',
      t1Title: '找邻居',
      t1Text: '有一个节点被高亮成蓝色。请点击所有与它由一条线直接相连的节点，然后点「提交」。',
      t1Hint: '你可以逐个点击节点来选中或取消，也可以在空白处拖出一个矩形一次选中多个。用鼠标滚轮缩放。',
      t4Title: '比较连接数',
      t4Text: '有两个节点被高亮成蓝色。请点击你认为连接更多的那个。点击即提交。',
      t2Title: '数邻居',
      t2Text: '有一个节点被高亮成蓝色。请输入与它直接相连的节点个数，然后点「提交」。',
      example: '示例',
    },

    trial: {
      t1Factual: '点击所有与高亮节点直接相连的节点。',
      t1Perceptual: '圈出你认为属于高亮节点邻域的节点。',
      t4: '两个高亮节点中，哪一个有更多的直接连接？',
      t2: '高亮节点有多少个直接邻居？',
      selectedNodes: '已选节点',
      none: '无',
      remove: '从选择中移除这个节点',
      selectAtLeastOne: '请至少选中一个节点再继续。',
      typeNumber: '请先输入一个数字。',
      typeNumberPlaceholder: '邻居数量',
      clickOneTarget: '请点击两个高亮节点之一。',
    },

    feedback: {
      t1: '正确答案有 {n} 个邻居，你找到了 {found} 个，多选了 {extra} 个。（Jaccard: {jaccard}）',
      t4Correct: '正确。',
      t4Wrong: '不对。',
      t4: '{verdict} 一个节点有 {hi} 个连接，另一个有 {lo} 个。',
      t2: '正确答案是 {truth}，你答的是 {answer}（相差 {error}）。',
    },

    ease: {
      title: '第 {n} 题',
      question: '回答这道题有多容易？',
      veryDifficult: '非常难',
      veryEasy: '非常容易',
      chooseValue: '请选择一个分值。',
    },

    tlx: {
      title: '任务负担如何？',
      hint: '请对下面每一项打分：0 = 非常低，100 = 非常高。',
      mental: '脑力需求 —— 这个任务在脑力上有多费力？',
      physical: '体力需求 —— 这个任务在体力上有多费力？',
      temporal: '时间压力 —— 你觉得节奏有多赶？',
      performance: '自评表现 —— 你觉得自己完成得怎么样？',
      effort: '努力程度 —— 为了达到你的表现水平，你付出了多大努力？',
      frustration: '挫败感 —— 你感到不安、沮丧、烦躁、紧张或恼火的程度？',
      pairsTitle: '下面两个因素，哪一个对你的负担贡献更大？',
      answerAllPairs: '请回答每一组比较。',
    },

    attention: {
      title: '理解力检查',
      text: '为了确认你在认真阅读，请在下面的输入框里输入单词 GRAPH。',
      empty: '请先输入内容。',
    },

    breakdown: {
      title: '休息一下',
      body: '你已完成 {done} / {total} 个试次。请让眼睛休息片刻。',
      skip: '现在继续',
    },

    done: {
      title: '谢谢，你已经完成实验。',
      completionCode: '请把下面这个完成码复制回 Prolific：',
      pid: '被试编号：{pid}',
      trials: '你完成了 {n} 个试次。',
      attention: '理解力检查通过：{passed} / {total}。',
      collect: '研究员会收集这个文件。你的数据以被试编号存储。',
      remoteCollect: '请把下载的这个文件【发回给研究者】。你的作答只存在这个浏览器里，'
        + '不发回来的话研究者拿不到。',
    },

    preference: {
      title: '哪一种布局最容易读？',
      hint: '实验过程中，你见过同样的图以不同方式绘制。请对下面四种风格排序：1 = 最容易，4 = 最难。',
      position: '位置 {pos}',
      posLeft: '左',
      posMiddleLeft: '中左',
      posMiddleRight: '中右',
      posRight: '右',
      useEachRank: '请把 1–4 每个名次各用一次。',
    },

    literacy: {
      title: '快速读图测验',
      hint: '没有时间限制，也不会影响你的评价，尽力就好。',
      question: '第 {n} 题',
    },

    errors: {
      title: '出错了',
      noData: '无法加载实验数据。请确认你是通过本地服务器打开的（例如 `python tools/serve.py`），而不是直接双击文件。',
      noPid: '缺少被试编号。',
      noPidDetail: '请在网址里带上被试编号，例如 http://localhost:8000/src/?pid=P001\n（在 Prolific 上会自动填入。）',
      alreadyDone: '这个被试编号已经完成过实验了。\n' +
        '要开始下一位被试：打开**不带 ?pid=** 的网址（会自动分配新编号），或换一个 ?pid=。',
      couldNotStart: '无法开始会话。',
      configProblem: '配置有问题',
      unexpected: '发生了意外错误。',
      tooNarrowTitle: '窗口太窄，无法进行本实验。',
      tooNarrowBody: '本实验要求桌面或笔记本屏幕宽度至少 {min}px（你的窗口是 {w}px）。\n\n请最大化浏览器窗口、关闭缩放，然后刷新页面。如果你用的是手机或平板，请不要继续——小屏幕采集的数据无法使用。',
      declinedTitle: '谢谢。',
      screenedOutTitle: '感谢你的关注。',
      screenedOutBody: '你不符合本次实验的要求（{n} 项）。本次没有记录任何数据。',
      redirecting: '正在带你返回 Prolific……',
    },
  },
};

let _locale = 'en';

/** 解析 locale：'auto' → 按浏览器语言，中文环境用中文。 */
export function resolveLocale(pref) {
  if (pref === 'zh' || pref === 'en') return pref;
  // Node（单测 / 构建脚本）里没有 navigator —— 回退英文，别让 import 就炸
  if (typeof navigator === 'undefined') return 'en';
  const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
  return langs.some((l) => /^zh\b/i.test(l)) ? 'zh' : 'en';
}

export function setLocale(pref) {
  _locale = resolveLocale(pref);
  document.documentElement.lang = _locale === 'zh' ? 'zh-CN' : 'en';
  return _locale;
}

export function getLocale() { return _locale; }

/** 取字符串并做 {name} 插值。找不到键时回退英文，再不行就返回键名（不静默变空）。 */
export function t(key, params = {}) {
  const read = (loc) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), DICT[loc]);
  let s = read(_locale);
  if (s === undefined) s = read('en');
  if (s === undefined) {
    console.warn(`[i18n] 缺少键：${key}`);
    return key;
  }
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
}
