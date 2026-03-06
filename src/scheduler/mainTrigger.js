/**
 * Main Trigger Scheduler - 12:05 AM IST
 * Triggers GitHub Actions workflow for video generation for ALL active channels
 */
const { triggerGitHubWorkflow } = require('../utils/github');
const { getCurrentEpisode, updateWorkflowStatus, getActiveChannels, saveEpisode } = require('../utils/firestore');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

async function generateForChannel(channel, channelIndex) {
  /**
   * Generate video for a single channel
   */
  const { channelId, name, ownerEmail, voiceFile } = channel;
  
  logger.info(`🎬 Starting generation for channel: ${name} (${channelId})`);
  
  try {
    // Get current episode for this channel
    const currentEpisode = await getCurrentEpisode(channelId);
    
    logger.info(`📋 Episode: ${currentEpisode.subCategory} - Ep ${currentEpisode.episode}`);
    
    // Trigger GitHub Actions workflow
    const result = await triggerGitHubWorkflow({
      run_id: `auto_${Date.now()}_${channelId}`,
      main_category: currentEpisode.mainCategory,
      sub_category: currentEpisode.subCategory,
      episode: currentEpisode.episode,
      channel_id: channelId,
      is_retry: false,
      attempt: 1
    });
    
    if (result.success) {
      // Save episode info
      await saveEpisode({
        channelId,
        episode: currentEpisode.episode,
        mainCategory: currentEpisode.mainCategory,
        subCategory: currentEpisode.subCategory,
        runId: result.runId,
        triggeredAt: new Date().toISOString(),
        status: 'triggered'
      });
      
      // Update workflow status
      await updateWorkflowStatus({
        runId: result.runId,
        status: 'triggered',
        triggeredAt: new Date().toISOString(),
        channelId,
        channelName: name,
        ownerEmail,
        category: currentEpisode.mainCategory,
        subCategory: currentEpisode.subCategory,
        episode: currentEpisode.episode,
        triggerType: 'main',
        scheduledFor: new Date().toISOString()
      });
      
      logger.info(`✅ Generation triggered for ${name}: ${result.runId}`);
      
      return {
        success: true,
        channelId,
        channelName: name,
        runId: result.runId
      };
    } else {
      throw new Error(`Trigger failed: ${result.error}`);
    }
    
  } catch (error) {
    logger.error(`❌ Generation failed for ${name}:`, error);
    
    // Store failure
    await updateWorkflowStatus({
      channelId,
      channelName: name,
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: error.message,
      triggerType: 'main'
    });
    
    return {
      success: false,
      channelId,
      channelName: name,
      error: error.message
    };
  }
}

async function generateForAllChannels() {
  /**
   * Main generation trigger at 12:05 AM IST
   * Triggers video generation for ALL active channels
   */
  
  logger.info('🎬 Starting main generation trigger for ALL channels');
  
  try {
    // Get all active channels
    const activeChannels = await getActiveChannels();
    
    if (activeChannels.length === 0) {
      logger.warn('⚠️ No active channels found');
      return {
        success: false,
        error: 'No active channels found'
      };
    }
    
    logger.info(`📺 Found ${activeChannels.length} active channels`);
    
    // Generate for each channel
    const results = [];
    for (let i = 0; i < activeChannels.length; i++) {
      const channel = activeChannels[i];
      const result = await generateForChannel(channel, i);
      results.push(result);
      
      // Small delay between triggers to avoid rate limiting
      if (i < activeChannels.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Summarize results
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    logger.info(`✅ Generation complete: ${successful} successful, ${failed} failed`);
    
    return {
      success: true,
      totalChannels: activeChannels.length,
      successful,
      failed,
      results
    };
    
  } catch (error) {
    logger.error('❌ Main trigger failed:', error);
    
    // Store failure
    await updateWorkflowStatus({
      status: 'failed',
      failedAt: new Date().toISOString(),
      error: error.message,
      triggerType: 'main'
    });
    
    throw error;
  }
}

async function mainTrigger() {
  /**
   * Legacy single-channel trigger
   * Kept for backward compatibility
   */
  return generateForAllChannels();
}

module.exports = { 
  mainTrigger,
  generateForAllChannels,
  generateForChannel
};
