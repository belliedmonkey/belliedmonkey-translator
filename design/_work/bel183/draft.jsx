<Frame name="BEL-183 · 稿 · Duo 卡 CTA 30-44 · 2026-11-03" w={2560} h="hug" bg="#f5ead8" flex="col" gap={36} p={56}>
  <Frame name="Header" w="fill" flex="col" gap={10}>
    <Text name="Title" w="fill" size={34} weight={700} color="#201e1d">BEL-183 · 首页 Duo 卡 · CTA 30 / 44</Text>
    <Text name="Subtitle" w="fill" size={15} lineHeight={1.5} color="#6a6255">OpenPencil 评审稿 · 2026-11-03 · 三形态对照（窄 / 宽·iPad / 宽·Mac）。口径：宽·Mac 指针 CTA 保持设计值 30，触控 44；44 的改法因设计测试与 CI 被否，已回退。卡高保持 220，不加高卡片、不裁切。实现 commit 44ad378d · 分支 rd/bel183-card-cta-height · 146 已撤审。</Text>
    <Frame name="Meta chips" w="fill" flex="row" gap={10} pt={4}>
      <Frame name="chip1" h={30} px={14} rounded={999} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1} flex="row" items="center"><Text name="t1" size={12} weight={500} color="#6a6255">恢复设计值：指针 CTA 30（44ad378d）</Text></Frame>
      <Frame name="chip2" h={30} px={14} rounded={999} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1} flex="row" items="center"><Text name="t2" size={12} weight={500} color="#6a6255">未动：窄窗 / iPad / 文案 / 颜色 / 间距</Text></Frame>
      <Frame name="chip3" h={30} px={14} rounded={999} bg="#e1eecc" flex="row" items="center"><Text name="t3" size={12} weight={500} color="#3d472b">验收：卡 220 · CTA 30/44 · clip 0</Text></Frame>
    </Frame>
  </Frame>

  <Frame name="三形态" w="fill" flex="row" gap={36} items="start">
    <Frame name="形态 01 · 窄" w={375} flex="col" gap={14}>
      <Frame name="label" w="fill" flex="col" gap={4}>
        <Text name="h" w="fill" size={15} weight={700} color="#201e1d">01 · 窄 · iPhone 375（分屏同此）</Text>
        <Text name="n" w="fill" size={12.5} lineHeight={1.45} color="#6a6255">单栏 · 卡 236 · CTA 44（本次未改）</Text>
      </Frame>
      <Frame name="window narrow 375" w={375} h={660} bg="#f5ead8" p={16} flex="col" gap={10} overflow="hidden" stroke="#dcd3c4" strokeWidth={1.5} rounded={24} shadow="0 2 8 #201e1d14">
        <Frame name="app header" w="fill" flex="row" justify="between" items="center" pb={14}>
          <Text name="app title" size={20} weight={700} color="#201e1d">大肚猴翻译</Text>
          <Frame name="account" w={36} h={36} rounded={999} bg="#ffe1d0" flex="row" items="center" justify="center"><Text name="initial" size={14} weight={700} color="#8c491a">B</Text></Frame>
        </Frame>
        <Frame name="heroes narrow" w="fill" flex="col" gap={10}>
          <Frame name="card listen narrow" w={343} h={236} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1.5} rounded={24} flex="col" items="start" shadow="0 1 2 #201e1d0d">
            <Frame name="icon chip" w={32} h={32} rounded={14} bg="#f9f4ed" flex="row" items="center" justify="center"><Icon name="lucide:mic" size={18} color="#8c491a" /></Frame>
            <Frame name="text block" w="fill" flex="col" gap={4} pt={12}>
              <Text name="title" w="fill" size={20} weight={700} color="#201e1d">对话 · 实时听译</Text>
              <Text name="sub" w="fill" size={12} color="#6a6255">Conversation · Live interpretation</Text>
            </Frame>
            <Frame name="desc wrap" w="fill" pt={8}><Text name="desc" w="fill" size={13.5} lineHeight={1.5} color="#6a6255">两个人面对面谈事情，各说各的话，译文自动读出来</Text></Frame>
            <Frame name="spacer" w="fill" h={1} grow={1} />
            <Frame name="cta row" w="fill" flex="row" justify="end"><Frame name="cta 44" h={44} px={20} rounded={999} bg="#ac6231" flex="row" items="center" justify="center"><Text name="cta label" size={16} weight={600} color="#ffffff">开始听译</Text></Frame></Frame>
          </Frame>
          <Frame name="card subs narrow" w={343} h={236} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1.5} rounded={24} flex="col" items="start" shadow="0 1 2 #201e1d0d">
            <Frame name="icon chip" w={32} h={32} rounded={14} bg="#f9f4ed" flex="row" items="center" justify="center"><Icon name="lucide:captions" size={18} color="#8c491a" /></Frame>
            <Frame name="text block" w="fill" flex="col" gap={4} pt={12}>
              <Text name="title" w="fill" size={20} weight={700} color="#201e1d">实时字幕</Text>
              <Text name="sub" w="fill" size={12} color="#6a6255">Live bilingual subtitles</Text>
            </Frame>
            <Frame name="desc wrap" w="fill" pt={8}><Text name="desc" w="fill" size={13.5} lineHeight={1.5} color="#6a6255">给正在播放的视频、直播、会议配双语字幕</Text></Frame>
            <Frame name="spacer" w="fill" h={1} grow={1} />
            <Frame name="cta row" w="fill" flex="row" justify="end"><Frame name="cta 44" h={44} px={20} rounded={999} bg="#ac6231" flex="row" items="center" justify="center"><Text name="cta label" size={16} weight={600} color="#ffffff">开始实时字幕</Text></Frame></Frame>
          </Frame>
        </Frame>
        <Frame name="below fold" w="fill" h={76} rounded={16} bg="#f9f4ed" stroke="#dcd3c4" strokeWidth={1} flex="row" items="center" px={16}><Text name="t" w="fill" size={11.5} color="#6a6255">下方：复习条 / 文档 / 播客（本次未改）</Text></Frame>
      </Frame>
    </Frame>

    <Frame name="形态 02 · 宽 iPad" w={768} flex="col" gap={14}>
      <Frame name="label" w="fill" flex="col" gap={4}>
        <Text name="h" w="fill" size={15} weight={700} color="#201e1d">02 · 宽 · iPad 全屏（768 / 1024）</Text>
        <Text name="n" w="fill" size={12.5} lineHeight={1.45} color="#6a6255">两列 · 卡 220 · CTA 44（触控 · 本次未改）</Text>
      </Frame>
      <Frame name="window ipad 768" w={768} h={470} bg="#f5ead8" p={20} flex="col" gap={12} overflow="hidden" stroke="#dcd3c4" strokeWidth={1.5} rounded={20} shadow="0 2 8 #201e1d14">
        <Frame name="app header" w="fill" flex="row" justify="between" items="center" pb={6}>
          <Text name="app title" size={20} weight={700} color="#201e1d">大肚猴翻译</Text>
          <Frame name="account" w={36} h={36} rounded={999} bg="#ffe1d0" flex="row" items="center" justify="center"><Text name="initial" size={14} weight={700} color="#8c491a">B</Text></Frame>
        </Frame>
        <Frame name="heroes wide" w="fill" flex="row" gap={16} items="stretch">
          <Frame name="card listen ipad" w={356} h={220} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1.5} rounded={16} flex="col" items="start" shadow="0 1 2 #201e1d0d">
            <Frame name="icon chip" w={36} h={36} rounded={14} bg="#f9f4ed" flex="row" items="center" justify="center"><Icon name="lucide:mic" size={21} color="#8c491a" /></Frame>
            <Frame name="text block" w="fill" flex="col" gap={4} pt={12}>
              <Text name="title" w="fill" size={16} weight={700} color="#201e1d">对话 · 实时听译</Text>
              <Text name="sub" w="fill" size={11} color="#6a6255">Conversation · Live interpretation</Text>
            </Frame>
            <Frame name="desc wrap" w="fill" pt={8}><Text name="desc" w="fill" size={12.5} lineHeight={1.5} color="#6a6255">两个人面对面谈事情，各说各的话，译文自动读出来</Text></Frame>
            <Frame name="spacer" w="fill" h={1} grow={1} />
            <Frame name="cta row" w="fill" flex="row" justify="end"><Frame name="cta 44" h={44} px={20} rounded={999} bg="#ac6231" flex="row" items="center" justify="center"><Text name="cta label" size={16} weight={600} color="#ffffff">开始听译</Text></Frame></Frame>
          </Frame>
          <Frame name="card subs ipad" w={356} h={220} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1.5} rounded={16} flex="col" items="start" shadow="0 1 2 #201e1d0d">
            <Frame name="icon chip" w={36} h={36} rounded={14} bg="#f9f4ed" flex="row" items="center" justify="center"><Icon name="lucide:captions" size={21} color="#8c491a" /></Frame>
            <Frame name="text block" w="fill" flex="col" gap={4} pt={12}>
              <Text name="title" w="fill" size={16} weight={700} color="#201e1d">实时字幕</Text>
              <Text name="sub" w="fill" size={11} color="#6a6255">Live bilingual subtitles</Text>
            </Frame>
            <Frame name="desc wrap" w="fill" pt={8}><Text name="desc" w="fill" size={12.5} lineHeight={1.5} color="#6a6255">给正在播放的视频、直播、会议配双语字幕</Text></Frame>
            <Frame name="spacer" w="fill" h={1} grow={1} />
            <Frame name="cta row" w="fill" flex="row" justify="end"><Frame name="cta 44" h={44} px={20} rounded={999} bg="#ac6231" flex="row" items="center" justify="center"><Text name="cta label" size={16} weight={600} color="#ffffff">开始实时字幕</Text></Frame></Frame>
          </Frame>
        </Frame>
        <Frame name="spacer bottom" w="fill" h={1} grow={1} />
        <Frame name="below fold" w="fill" h={76} rounded={16} bg="#f9f4ed" stroke="#dcd3c4" strokeWidth={1} flex="row" items="center" px={16}><Text name="t" w="fill" size={11.5} color="#6a6255">下方：复习条 / 文档 / 播客（本次未改）</Text></Frame>
      </Frame>
    </Frame>

    <Frame name="形态 03 · 宽 Mac" w={1166} flex="col" gap={14}>
      <Frame name="label" w="fill" flex="col" gap={4}>
        <Text name="h" w="fill" size={15} weight={700} color="#201e1d">03 · 宽 · Mac ≥720（本次改动）</Text>
        <Text name="n" w="fill" size={12.5} lineHeight={1.45} color="#8c491a">两列 · 卡 220 · CTA 30（指针）· 裁切 0 —— 与 BEL-168 设计一致</Text>
      </Frame>
      <Frame name="window mac 1166" w={1166} h={492} bg="#f5ead8" flex="col" overflow="hidden" stroke="#dcd3c4" strokeWidth={1.5} rounded={20} shadow="0 2 8 #201e1d14">
        <Frame name="titlebar" w="fill" h={38} bg="#f9f4ed" flex="row" items="center" px={16} gap={8}>
          <Frame name="dot r" w={12} h={12} rounded={999} bg="#ff5f57" />
          <Frame name="dot y" w={12} h={12} rounded={999} bg="#febc2e" />
          <Frame name="dot g" w={12} h={12} rounded={999} bg="#28c840" />
          <Frame name="grow" w={1} h={1} grow={1} />
          <Text name="win title" size={12.5} weight={500} color="#6a6255">BelliedMonkey Translator</Text>
          <Frame name="grow2" w={1} h={1} grow={1} />
          <Frame name="spacer right" w={52} h={1} />
        </Frame>
        <Frame name="body" w="fill" h="fill" p={24} flex="col" gap={12}>
          <Frame name="app header" w="fill" flex="row" justify="between" items="center" pb={6}>
            <Text name="app title" size={20} weight={700} color="#201e1d">大肚猴翻译</Text>
            <Frame name="account" w={36} h={36} rounded={999} bg="#ffe1d0" flex="row" items="center" justify="center"><Text name="initial" size={14} weight={700} color="#8c491a">B</Text></Frame>
          </Frame>
          <Frame name="heroes wide" w="fill" flex="row" gap={16} items="stretch">
            <Frame name="card listen mac" w={551} h={220} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1.5} rounded={16} flex="col" items="start" shadow="0 1 2 #201e1d0d">
              <Frame name="icon chip" w={36} h={36} rounded={14} bg="#f9f4ed" flex="row" items="center" justify="center"><Icon name="lucide:mic" size={21} color="#8c491a" /></Frame>
              <Frame name="text block" w="fill" flex="col" gap={4} pt={12}>
                <Text name="title" w="fill" size={16} weight={700} color="#201e1d">对话 · 实时听译</Text>
                <Text name="sub" w="fill" size={11} color="#6a6255">Conversation · Live interpretation</Text>
              </Frame>
              <Frame name="desc wrap" w="fill" pt={8}><Text name="desc" w="fill" size={12.5} lineHeight={1.5} color="#6a6255">两个人面对面谈事情，各说各的话，译文自动读出来</Text></Frame>
              <Frame name="spacer" w="fill" h={1} grow={1} />
              <Frame name="cta row" w="fill" flex="row" justify="end"><Frame name="cta 30" h={30} px={20} rounded={999} bg="#ac6231" flex="row" items="center" justify="center"><Text name="cta label" size={13} weight={600} color="#ffffff">开始听译</Text></Frame></Frame>
            </Frame>
            <Frame name="card subs mac" w={551} h={220} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1.5} rounded={16} flex="col" items="start" shadow="0 1 2 #201e1d0d">
              <Frame name="icon chip" w={36} h={36} rounded={14} bg="#f9f4ed" flex="row" items="center" justify="center"><Icon name="lucide:captions" size={21} color="#8c491a" /></Frame>
              <Frame name="text block" w="fill" flex="col" gap={4} pt={12}>
                <Text name="title" w="fill" size={16} weight={700} color="#201e1d">实时字幕</Text>
                <Text name="sub" w="fill" size={11} color="#6a6255">Live bilingual subtitles</Text>
              </Frame>
              <Frame name="desc wrap" w="fill" pt={8}><Text name="desc" w="fill" size={12.5} lineHeight={1.5} color="#6a6255">给正在播放的视频、直播、会议配双语字幕</Text></Frame>
              <Frame name="spacer" w="fill" h={1} grow={1} />
              <Frame name="cta row" w="fill" flex="row" justify="end"><Frame name="cta 30" h={30} px={20} rounded={999} bg="#ac6231" flex="row" items="center" justify="center"><Text name="cta label" size={13} weight={600} color="#ffffff">开始实时字幕</Text></Frame></Frame>
            </Frame>
          </Frame>
          <Frame name="spacer bottom" w="fill" h={1} grow={1} />
          <Frame name="below fold" w="fill" h={76} rounded={16} bg="#f9f4ed" stroke="#dcd3c4" strokeWidth={1} flex="row" items="center" px={16}><Text name="t" w="fill" size={11.5} color="#6a6255">下方：复习条 / 文档 / 播客（本次未改）</Text></Frame>
        </Frame>
      </Frame>
    </Frame>
  </Frame>

  <Frame name="Spec strip" w="fill" flex="row" gap={16}>
    <Frame name="stat card" w={280} h={112} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1} rounded={16} flex="col" justify="between">
      <Text name="v" size={26} weight={700} color="#201e1d">220 pt</Text>
      <Text name="k" size={12} color="#6a6255">卡高（BEL-168 设计值，不变）</Text>
    </Frame>
    <Frame name="stat card" w={280} h={112} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1} rounded={16} flex="col" justify="between">
      <Text name="v" size={26} weight={700} color="#201e1d">30 / 44 pt</Text>
      <Text name="k" size={12} color="#6a6255">CTA 盒高（Mac 指针 30 / 触控 44）</Text>
    </Frame>
    <Frame name="stat card" w={280} h={112} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1} rounded={16} flex="col" justify="between">
      <Text name="v" size={26} weight={700} color="#201e1d">30 pt</Text>
      <Text name="k" size={12} color="#6a6255">CTA 可见高（Mac 指针，60 px @2x，±0）</Text>
    </Frame>
    <Frame name="stat card" w={280} h={112} p={18} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1} rounded={16} flex="col" justify="between">
      <Text name="v" size={26} weight={700} color="#201e1d">0 pt</Text>
      <Text name="k" size={12} color="#6a6255">裁切（820×669 整页滚 209 pt，非裁切）</Text>
    </Frame>
    <Frame name="danger note" w="fill" h={112} p={18} bg="#fdf1ec" stroke="#e5b9a4" strokeWidth={1} rounded={16} flex="col" justify="center" gap={6}>
      <Text name="t" size={13} weight={700} color="#b3261e">修复前（146，已撤审，不再上架）</Text>
      <Text name="d" size={12.5} lineHeight={1.5} color="#6a6255">卡 168 · CTA 可见 14.5 · 裁 29.5 —— 宽·Mac 主入口文案不可见。根因：#signed-in 的 168 块与 220 块特异度打架；146 是相对线上 145 的回归。</Text>
    </Frame>
  </Frame>

  <Frame name="Sign-off" w="fill" p={24} bg="#ffffff" stroke="#dcd3c4" strokeWidth={1} rounded={16} flex="col" gap={12}>
    <Text name="title" size={16} weight={700} color="#201e1d">待你签核（三项）</Text>
    <Frame name="row 1" w="fill" flex="row" gap={10} items="center">
      <Frame name="box" w={18} h={18} rounded={4} bg="#ffffff" stroke="#ac6231" strokeWidth={1.5} />
      <Text name="t" w="fill" size={13.5} color="#201e1d">宽·Mac 的 CTA 保持 30（BEL-168 设计值）；44 改法不采纳 —— 同意 / 打回</Text>
    </Frame>
    <Frame name="row 2" w="fill" flex="row" gap={10} items="center">
      <Frame name="box" w={18} h={18} rounded={4} bg="#ffffff" stroke="#ac6231" strokeWidth={1.5} />
      <Text name="t" w="fill" size={13.5} color="#201e1d">卡高保持 220，不加高卡片；820×669 接受整页滚 209 pt</Text>
    </Frame>
    <Frame name="row 3" w="fill" flex="row" gap={10} items="center">
      <Frame name="box" w={18} h={18} rounded={4} bg="#ffffff" stroke="#ac6231" strokeWidth={1.5} />
      <Text name="t" w="fill" size={13.5} color="#201e1d">通过后：同 commit 更新 docs/interaction-spec.md → 在 148 真包上走像素验收（220 / 30 / 0）→ 才提审</Text>
    </Frame>
    <Text name="note" w="fill" size={12} lineHeight={1.5} color="#6a6255">本稿只覆盖首页 Duo 卡这一变更面；窄窗与 iPad 列仅作回归对照，不改。稿子存于 design/_work/bel183/（30/44 定稿版），导出 PNG 同名。</Text>
  </Frame>
</Frame>
