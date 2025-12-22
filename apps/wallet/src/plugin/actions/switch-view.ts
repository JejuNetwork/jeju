/**
 * Switch View Action
 * 
 * Switches between simple and advanced wallet views.
 */

import type { ActionContext, ActionResult } from './wallet-info';

interface SwitchViewParams {
  targetMode?: 'simple' | 'advanced';
}

export const switchViewAction = {
  name: 'SWITCH_VIEW',
  description: 'Switch between simple and advanced wallet view modes',
  similes: ['CHANGE_VIEW', 'TOGGLE_VIEW', 'ADVANCED_MODE', 'SIMPLE_MODE'],
  
  parseParams(text: string): SwitchViewParams {
    if (text.toLowerCase().includes('advanced')) {
      return { targetMode: 'advanced' };
    }
    if (text.toLowerCase().includes('simple') || text.toLowerCase().includes('normie')) {
      return { targetMode: 'simple' };
    }
    return {};
  },
  
  async execute(
    context: ActionContext,
    params: SwitchViewParams
  ): Promise<ActionResult> {
    context.logger.info('[SwitchView] Processing view mode change');
    
    const { walletService } = context;
    
    if (!walletService) {
      return { success: false, message: 'Wallet service not available' };
    }
    
    const currentMode = walletService.getViewMode();
    const targetMode = params.targetMode || (currentMode === 'simple' ? 'advanced' : 'simple');
    
    walletService.setViewMode(targetMode);
    
    const modeDescription = targetMode === 'advanced'
      ? 'Advanced mode shows detailed transaction data, gas settings, and technical information.'
      : 'Simple mode provides a streamlined view with essential information only.';
    
    return {
      success: true,
      message: `Switched to **${targetMode}** mode.

${modeDescription}`,
      data: { viewMode: targetMode },
    };
  },
};

export default switchViewAction;
