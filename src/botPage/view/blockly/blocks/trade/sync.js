// https://blockly-demo.appspot.com/static/demos/blockfactory/index.html#zr2375
import { translator } from '../../../../../common/translator';
import { insideTrade } from '../../relationChecker';

Blockly.Blocks.sync = {
  init: function init() {
    this.appendDummyInput()
      .appendField('Synchronize Trades');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setTooltip(translator.translateText('Synchronizes all trade purchases across all browser tabs')); // eslint-disable-line max-len
    this.setHelpUrl('https://github.com/binary-com/binary-bot/wiki');
  },
  onchange: function onchange(ev) {
    insideTrade(this, ev);
  },
};

Blockly.JavaScript.sync = () => `
  sync = true;
  Bot.setId();
  Bot.startPurchase();
`;
