import { observer } from 'binary-common-utils/lib/observer'
import { translator } from '../../../common/translator'
import { bot } from '../../bot'
import { notifyError } from '../logger'
import { isMainBlock, save, getMainBlocks,
  disable, deleteBlocksLoadedBy,
} from './utils'
import blocks from './blocks'

const backwardCompatibility = (block) => {
  if (block.getAttribute('type') === 'on_strategy') {
    block.setAttribute('type', 'before_purchase')
  } else if (block.getAttribute('type') === 'on_finish') {
    block.setAttribute('type', 'after_purchase')
  }
  for (const statement of Array.prototype.slice.call(block.getElementsByTagName('statement'))) {
    if (statement.getAttribute('name') === 'STRATEGY_STACK') {
      statement.setAttribute('name', 'BEFOREPURCHASE_STACK')
    } else if (statement.getAttribute('name') === 'FINISH_STACK') {
      statement.setAttribute('name', 'AFTERPURCHASE_STACK')
    }
  }
}

const setMainBlocksDeletable = () => {
  for (const block of getMainBlocks()) {
    block.setDeletable(true)
  }
}

const disableStrayBlocks = () => {
  const topBlocks = Blockly.mainWorkspace.getTopBlocks()
  for (const block of topBlocks) {
    if (!isMainBlock(block.type)
      && [
        'block_holder',
        'tick_analysis',
        'loader',
        'procedures_defreturn',
        'procedures_defnoreturn',
      ].indexOf(block.type) < 0
      && !block.disabled) {
        disable(block,
          translator.translateText('Blocks must be inside block holders, main blocks or functions'))
      }
  }
}

const getCollapsedProcedures = () => Blockly.mainWorkspace.getTopBlocks().filter(
  (block) => (!isMainBlock(block.type)
      && block.collapsed_ && block.type.indexOf('procedures_def') === 0))

const fixCollapsedBlocks = () => {
  for (const block of getCollapsedProcedures()) {
    block.setCollapsed(false)
    block.setCollapsed(true)
  }
}

const cleanUpOnLoad = (blocksToClean, dropEvent) => {
  const { clientX = 0, clientY = 0 } = dropEvent || {}
  const blocklyMetrics = Blockly.mainWorkspace.getMetrics()
  const scaleCancellation = (1 / Blockly.mainWorkspace.scale)
  const blocklyLeft = blocklyMetrics.absoluteLeft - blocklyMetrics.viewLeft
  const blocklyTop = (document.body.offsetHeight - blocklyMetrics.viewHeight) - blocklyMetrics.viewTop
  const cursorX = (clientX) ? (clientX - blocklyLeft) * scaleCancellation : 0
  let cursorY = (clientY) ? (clientY - blocklyTop) * scaleCancellation : 0
  for (const block of blocksToClean) {
    block.moveBy(cursorX, cursorY)
    block.snapToGrid()
    cursorY += block.getHeightWidth().height + Blockly.BlockSvg.MIN_BLOCK_Y
  }
  // Fire an event to allow scrollbars to resize.
  Blockly.mainWorkspace.resizeContents()
}

const createXmlTag = (obj) => {
  let xmlStr = '<category name="Markets" colour="#2a3052" i18n-text="Markets">\n'
  for (const market of Object.keys(obj)) {
    xmlStr += `\t<category name="${obj[market].name}" colour="#2a3052">`
    for (const submarket of Object.keys(obj[market].submarkets)) {
      xmlStr += `\t\t<category name="${
        obj[market].submarkets[submarket].name}" colour="#2a3052">`
      for (const symbol of Object.keys(obj[market].submarkets[submarket].symbols)) {
        if (bot.symbol.getAllowedCategoryNames(symbol).length) {
          xmlStr += `\t\t\t<block type="${symbol.toLowerCase()}"></block>`
        }
      }
      xmlStr += '\t\t</category>\n'
    }
    xmlStr += '\t</category>\n'
  }
  xmlStr += '</category>\n'
  return xmlStr
}

const disposeBlocksWithLoaders = () => {
  Blockly.mainWorkspace.addChangeListener((ev) => {
    if (ev.type === 'delete' && ev.oldXml.getAttribute('type') === 'loader') {
      deleteBlocksLoadedBy(ev.blockId)
    }
  })
}

export default class _Blockly {
  constructor() {
    this.blocksXmlStr = ''
    this.generatedJs = ''
    this.addBlocklyTranslation()
    Blockly.WorkspaceSvg.prototype.preloadAudio_ = () => {} // https://github.com/google/blockly/issues/299
    this.initPromise = new Promise((resolve) => {
      $.get('xml/toolbox.xml', (toolbox) => {
        blocks()
        const workspace = Blockly.inject('blocklyDiv', {
          toolbox: this.xmlToStr(translator.translateXml($.parseXML(
            this.marketsToXml(toolbox.getElementsByTagName('xml')[0])
          ))),
          zoom: {
            wheel: false,
          },
          trashcan: false,
        })
        $.get('xml/main.xml', (main) => {
          this.overrideBlocklyDefaultShape()
          this.blocksXmlStr = Blockly.Xml.domToPrettyText(main)
          Blockly.Xml.domToWorkspace(main.getElementsByTagName('xml')[0], workspace)
          this.zoomOnPlusMinus()
          Blockly.mainWorkspace.clearUndo()
          disposeBlocksWithLoaders()
          resolve()
        })
      })
    })
  }
  zoomOnPlusMinus(zoomIn) {
    const metrics = Blockly.mainWorkspace.getMetrics()
    if (zoomIn) {
      Blockly.mainWorkspace.zoom(metrics.viewWidth / 2, metrics.viewHeight / 2, 1)
    } else {
      Blockly.mainWorkspace.zoom(metrics.viewWidth / 2, metrics.viewHeight / 2, -1)
    }
  }
  cleanUp() {
    Blockly.Events.setGroup(true)
    const topBlocks = Blockly.mainWorkspace.getTopBlocks(true)
    let cursorY = 0
    for (const block of topBlocks) {
      if (block.getSvgRoot().style.display !== 'none') {
        const xy = block.getRelativeToSurfaceXY()
        block.moveBy(-xy.x, cursorY - xy.y)
        block.snapToGrid()
        cursorY = block.getRelativeToSurfaceXY().y +
          block.getHeightWidth().height + Blockly.BlockSvg.MIN_BLOCK_Y
      }
    }
    Blockly.Events.setGroup(false);
    // Fire an event to allow scrollbars to resize.
    Blockly.mainWorkspace.resizeContents();
  }
  xmlToStr(xml) {
    const serializer = new XMLSerializer()
    return serializer.serializeToString(xml)
  }
  marketsToXml(xml) {
    const xmlStr = this.xmlToStr(xml)
    const marketXml = createXmlTag(bot.symbol.activeSymbols.getMarkets())
    return xmlStr.replace('<!--Markets-->', marketXml)
  }
  overrideBlocklyDefaultShape() {
    Blockly.Blocks.text.newQuote_ = (open) => { // eslint-disable-line no-underscore-dangle
      let file
      if (open === this.RTL) {
        file = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAJCAYAAAAGuM1UAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAFpJREFUeNpiZGBg+M+ACRyh9H50CSYGEsEg1AACDlB8HxoAIKwAxAJIcu+h4u+RNcEUz0czMAFJroEBKfiQTUcG95FMF2BBUnAAiA8C8QM05z6A4o1A/AEgwACTSBqO/l02SwAAAABJRU5ErkJggg=='; // eslint-disable-line max-len
      } else {
        file = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAJCAYAAAAGuM1UAAAAAXNSR0IArs4c6QAAActpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDUuNC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyI+CiAgICAgICAgIDx4bXA6Q3JlYXRvclRvb2w+QWRvYmUgSW1hZ2VSZWFkeTwveG1wOkNyZWF0b3JUb29sPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KKS7NPQAAAHFJREFUGBljYICAAiC1H4odIEJwsgHIgskpgEQFgPg9EP8H4vtAjAwUgByQOAjvB2IwaACSMMEEsAiCmI8k5wASZgRikOkgWz4AcSAQg8AFIAaJ3QdxgOABECeCGCANINPRgSNUYD+6BBO6ACH+INQAAKsvFws0VtvEAAAAAElFTkSuQmCC'; // eslint-disable-line max-len
      }
      return new Blockly.FieldImage(file, 12, 12, '"')
    }
    Blockly.Blocks.texts.HUE = '#dedede'
    Blockly.Blocks.math.HUE = '#dedede'
    Blockly.Blocks.logic.HUE = '#dedede'
    Blockly.Blocks.loops.HUE = '#dedede'
    Blockly.Blocks.lists.HUE = '#dedede'
    Blockly.Blocks.variables.HUE = '#dedede'
    Blockly.Blocks.procedures.HUE = '#dedede'
    const addDownloadToMenu = (block) => {
      if (block instanceof Object) {
        block.customContextMenu = function customContextMenu(options) { // eslint-disable-line no-param-reassign, max-len
          options.push({
            text: translator.translateText('Download'),
            enabled: true,
            callback: () => {
              const xml = Blockly.Xml.textToDom('<xml xmlns="http://www.w3.org/1999/xhtml" collection="false"></xml>')
              xml.appendChild(Blockly.Xml.blockToDom(this))
              save('binary-bot-block', true, xml)
            },
          })
        }
      }
    }
    for (const blockName of Object.keys(Blockly.Blocks)) {
      addDownloadToMenu(Blockly.Blocks[blockName])
    }
  }
  addDomAsBlock(blockXml, header = null) {
    if (header) {
      Blockly.Events.recordUndo = false
      const block = Blockly.Xml.domToBlock(blockXml, Blockly.mainWorkspace)
      block.getSvgRoot().style.display = 'none'
      block.loaderId = header.id
      header.loadedByMe.push(block.id)
      Blockly.Events.recordUndo = true
      return block
    }
    backwardCompatibility(blockXml)
    const blockType = blockXml.getAttribute('type')
    if (isMainBlock(blockType)) {
      for (const b of Blockly.mainWorkspace.getTopBlocks()) {
        if (b.type === blockType) {
          b.dispose()
        }
      }
    }
    return Blockly.Xml.domToBlock(blockXml, Blockly.mainWorkspace)
  }
  resetWorkspace() {
    Blockly.Events.setGroup(true)
    Blockly.mainWorkspace.clear()
    Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(this.blocksXmlStr), Blockly.mainWorkspace)
    Blockly.Events.setGroup(false)
  }
  loadWorkspace(xml) {
    Blockly.mainWorkspace.clear()
    for (const block of Array.prototype.slice.call(xml.children)) {
      backwardCompatibility(block)
    }
    Blockly.Xml.domToWorkspace(xml, Blockly.mainWorkspace)
    this.blocksXmlStr = Blockly.Xml.domToPrettyText(
      Blockly.Xml.workspaceToDom(Blockly.mainWorkspace))
    observer.emit('ui.log.success',
      translator.translateText('Blocks are loaded successfully'))
  }
  loadBlocks(xml, dropEvent = {}, header = null) {
    const addedBlocks = []
    for (const block of Array.prototype.slice.call(xml.children)) {
      if (!header || [
          'tick_analysis',
          'procedures_defreturn',
          'procedures_defnoreturn',
          'loader'].indexOf(block.getAttribute('type')) >= 0) {
        const newBlock = this.addDomAsBlock(block, header)
        if (newBlock) {
          addedBlocks.push(newBlock)
        }
      }
    }
    cleanUpOnLoad(addedBlocks, dropEvent)
    observer.emit('ui.log.success',
      translator.translateText('Blocks are loaded successfully'))
  }
  selectBlockByText(text) {
    let returnVal
    $('.blocklyText').each(function each() {
      if ($(this).text().indexOf(text) >= 0) {
        returnVal = $(this).parent()[0]
      }
    })
    return returnVal
  }
  load(blockStr = '', dropEvent = {}, header = null) {
    if (blockStr.indexOf('<xml') !== 0) {
      observer.emit('ui.log.error',
        translator.translateText('Unrecognized file format.'))
    } else {
      Blockly.Events.setGroup('load')
      try {
        const xml = Blockly.Xml.textToDom(blockStr)
        if (!header) {
          if (xml.hasAttribute('collection') && xml.getAttribute('collection') === 'true') {
            this.loadBlocks(xml, dropEvent)
          } else {
            this.loadWorkspace(xml)
          }
          setMainBlocksDeletable()
          fixCollapsedBlocks()
        } else if (xml.hasAttribute('collection') && xml.getAttribute('collection') === 'true') {
          this.loadBlocks(xml, null, header)
        } else {
          observer.emit('ui.log.error',
            translator.translateText('Remote blocks to load must be a collection.'))
        }
      } catch (e) {
        if (e.name === 'BlocklyError') {
          // pass
        } else {
          observer.emit('ui.log.error',
            translator.translateText('Unrecognized file format.'))
        }
      }
      Blockly.Events.setGroup(false)
    }
  }
  save(filename, collection) {
    const xml = Blockly.Xml.workspaceToDom(Blockly.mainWorkspace)
    for (const blockDom of Array.prototype.slice.call(xml.children)) {
      const block = Blockly.mainWorkspace.getBlockById(blockDom.getAttribute('id'))
      if ('loaderId' in block) {
        blockDom.remove()
      }
    }
    save(filename, collection, xml)
  }
  run() {
    let code
    try {
      window.LoopTrap = 99999999999
      Blockly.JavaScript
        .INFINITE_LOOP_TRAP = 'if (--window.LoopTrap == 0) { Bot.notifyError("Infinite loop!"); throw "Infinite loop."; }\n'
      disableStrayBlocks()
      code = `
        var trade, before_purchase, during_purchase, after_purchase;
        var tick_analysis_list = [];
        ${Blockly.JavaScript.workspaceToCode(Blockly.mainWorkspace)}
        try {
          if (typeof trade !== 'undefined') {
            trade();
          }
        } catch (e) {
          if (e.name !== 'BlocklyError') {
            Bot.notifyError(e);
            throw e;
          }
        }
      `
      Blockly.JavaScript.INFINITE_LOOP_TRAP = null
      this.generatedJs = code
    } catch (e) {
      if (e.name !== 'BlocklyError') {
        notifyError(e)
        throw e
      }
    }
    if (code) {
      eval(code); // eslint-disable-line no-eval
      $('#summaryPanel')
        .show()
    }
  }
  addBlocklyTranslation() {
    $.ajaxPrefilter((options) => {
      options.async = true; // eslint-disable-line no-param-reassign
    })
    const script = document.createElement('script')
    script.type = 'text/javascript'
    script.src = `https://blockly-demo.appspot.com/static/msg/js/${translator.getLanguage()}.js`
    $('body').append(script)
  }
  undo() {
    Blockly.mainWorkspace.undo()
  }
  redo() {
    Blockly.mainWorkspace.undo(true)
  }
}
