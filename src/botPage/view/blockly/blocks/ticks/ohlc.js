// https://blockly-demo.appspot.com/static/demos/blockfactory/index.html#2jo335
import { beforeSell } from '../../relationChecker'
import { translator } from '../../../../../common/translator'

Blockly.Blocks.ohlc = {
  init: function init() {
    this.appendDummyInput()
      .appendField(translator.translateText('Candles List'))
    this.setOutput(true, 'Array')
    this.setColour('#f2f2f2')
    this.setTooltip(translator.translateText('Returns the candle list')); // eslint-disable-line max-len
    this.setHelpUrl('https://github.com/binary-com/binary-bot/wiki')
  },
  onchange: function onchange(ev) {
    beforeSell(this, ev, 'Candles List')
  },
}
Blockly.JavaScript.ohlc = () => ['Bot.expect.notEmptyArray(ticks.ohlc)', Blockly.JavaScript.ORDER_ATOMIC]
