import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
    intents: [
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages
    ],
    partials: ['CHANNEL'],
  });
  
client.once('clientReady', () => {
    console.log(`up to work ${client.user.tag}`);
});

const userStates = new Map();
const channelListMapping = new Map();

/**
 * Gets click up list id for a given channel
 * @param {string} channelName - The name of the Discord channel
 * @returns {string|null} The clickup list id or null if not configured
 */
function getClickUpListId(channelName) {
  if (channelListMapping.has(channelName)) {
    return channelListMapping.get(channelName);
  }
  return null;
}

/**
 * Set a ClickUp list ID for a specific channel
 * @param {string} channelName - The name of the Discord channel
 * @param {string} listId - The ClickUp list ID
 */
function setChannelListId(channelName, listId) {
  channelListMapping.set(channelName, listId);
  console.log(`Channel '${channelName}' mapped to list ID: ${listId}`);
}

/**
 * Get all configured channel mappings
 * @returns {Object} Object with channel mappings
 */
function getAllChannelMappings() {
  const mappings = {};
  for (const [channel, listId] of channelListMapping.entries()) {
    mappings[channel] = listId;
  }
  return mappings;
}

/**
 * Handle incoming messages
 * @param {Message} message - The message object
 */
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const userId = message.author.id;
    const userState = userStates.get(userId);

    // Handle configuration commands
    if (message.content.startsWith('--set list')) {
        //if (!message.member?.permissions.has('ADMINISTRATOR')) {
        //    return message.reply('You need administrator permissions to use this command.');
        //}

        const args = message.content.split(' ');
        if (args.length !== 3 || args[1] !== 'list') {
            return message.reply('❌ Invalid command format. Use: `--set list {listID}`');
        }
        const listId = args[2];
        const channelName = message.channel.id;

        if (!listId || listId.length < 5) {
            return message.reply('❌ Please provide a valid clickup list ID.');
        }

        setChannelListId(channelName, listId);
        return message.reply(`✅ Channel **${channelName}** is now mapped to ClickUp list ID: **${listId}**`);
    }

    // Handle list command to show current mappings
    if (message.content === '--list') {
        if (!message.member?.permissions.has('ADMINISTRATOR')) {
            return message.reply('🚨 You need administrator permissions to use this command.');
        }

        const mappings = getAllChannelMappings();
        if (Object.keys(mappings).length === 0) {
            return message.reply('📝 No channel mappings configured yet. Use `--set list ID {listID}` to configure.');
        }

        let response = '📝 **Current Channel Mappings:**\n';
        for (const [channel, listId] of Object.entries(mappings)) {
            response += `• **${channel}**: \`${listId}\`\n`;
        }
        return message.reply(response);
    }

    //1. first step 
    if (message.content.toLowerCase() === 'hello' || message.content.toLowerCase() === 'hi' || message.content.toLowerCase() === 'help') {
        userStates.set(userId, { step: 'init_conversation' });
        return message.reply("👋 Hi! What task or problem would you like to report? Please provide the url where the problem is happening");
    }
    //2. get details from user
    if (userState?.step === 'init_conversation') {
        userState.details = message.content;
        userState.step = 'awaiting_title';
        return message.reply("Got it! Please provide a short title for this task.");
    }
    //3. get evidence from user
    if (userState?.step === 'awaiting_title') { 
        userState.title = message.content;
        userState.step = 'awaiting_evidence';
        return message.reply("Great! now, could you attach any related evidence like screenshots or screen recordings?");
    }
    // 4. handle attachments and send ticket to click up
    if (userState?.step === 'awaiting_evidence') {
        let attachmentUrl = null;
        let attachmentType = null;
        let attachmentName = null;

        // Check for file attachments
        if (message.attachments.size > 0) {
          const attachment = message.attachments.first();
          attachmentUrl = attachment.url;
          attachmentType = 'file';
          attachmentName = attachment.name;
        }
        // check for urls in message 
        else if (message.content) {
          const urlRegex = /(https?:\/\/[^\s]+)/g;
          const urls = message.content.match(urlRegex);
          if (urls && urls.length > 0) {
            attachmentUrl = urls[0];
            attachmentType = 'url';
            attachmentName = 'External Link';
          }
        }
        try {
            // Get the appropriate ClickUp list ID based on channel
            const channel = message.channel.id ?? 'Direct Message';
            const channelName = message.channel.name;
            const clickUpListId = getClickUpListId(channel);
            
            // Validate that we have a valid list ID
            if (!clickUpListId) {
                throw new Error(`No ClickUp list configured for channel: ${channelName}. Use '--set list {listID}' to configure this channel.`);
            }
            
            // Create task in ClickUp
            const reporterInfo = `
            **Reporter:** ${message.author.username}#${message.author.discriminator}
            **User ID:** ${message.author.id}
            **Channel:** ${message.channel.name ?? 'Direct Message'}

            ---

            ${userState.details}
            `;
            const createTask = await fetch(`https://api.clickup.com/api/v2/list/${clickUpListId}/task`, {
              method: 'POST',
              headers: {
                'Authorization': process.env.CLICKUP_TOKEN,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: userState.title,
                description: reporterInfo,
              }),
            });
      
            const taskData = await createTask.json();
      
            let uploadResult = null;
            if (taskData.id && attachmentUrl) {
              try {
                if (attachmentType === 'file') {
                  // get file from message
                  const fileResponse = await fetch(attachmentUrl);
                  const arrayBuffer = await fileResponse.arrayBuffer();
                  const fileBuffer = Buffer.from(arrayBuffer);
                  
                  const FormData = (await import('form-data')).default;
                  const form = new FormData();
                  form.append('attachment', fileBuffer, attachmentName);
                  
                  // upload file to clickup
                  const uploadResponse = await fetch(`https://api.clickup.com/api/v2/task/${taskData.id}/attachment`, {
                    method: 'POST',
                    headers: { 
                      'Authorization': process.env.CLICKUP_TOKEN,
                      ...form.getHeaders()
                    },
                    body: form,
                  });
                  
                  uploadResult = await uploadResponse.json();
                } 
                else if (attachmentType === 'url') {
                  // add url in task description
                  const updatedDescription = `${reporterInfo}\n\n**Evidence Link Provided By User:** ${attachmentUrl}`;
                  
                  const updateResponse = await fetch(`https://api.clickup.com/api/v2/task/${taskData.id}`, {
                    method: 'PUT',
                    headers: {
                      'Authorization': process.env.CLICKUP_TOKEN,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      description: updatedDescription,
                    }),
                  });
                  
                  uploadResult = await updateResponse.json();
                }
              } catch (uploadError) {
                console.error('Error handling attachment:', uploadError);
                uploadResult = { error: 'Failed to process attachment' };
              }
            }
            
            await message.reply(`✅ Success! Your task has been created. Reference number: **${taskData.id}**`);
          } catch (err) {
            console.error(err);
            await message.reply('🚨 There was an error creating the task.');
          }
      
          userStates.delete(userId);
      }
});

// start client
client.login(process.env.DISCORD_TOKEN).catch(console.error);
  
  