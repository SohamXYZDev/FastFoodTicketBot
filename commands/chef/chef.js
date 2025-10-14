const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chef')
        .setDescription('Set your chef status')
        .addStringOption(option =>
            option.setName('status')
                .setDescription('Chef status')
                .setRequired(true)
                .addChoices(
                    { name: 'Open', value: 'OPEN' },
                    { name: 'Busy', value: 'BUSY' },
                    { name: 'Closed', value: 'CLOSED' }
                ))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The chef user (leave blank for yourself)')
                .setRequired(false)),
    
    async execute(interaction, client, db) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const status = interaction.options.getString('status');
        
        // Check if user has chef role or admin permissions
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasChefRole = member.roles.cache.has(process.env.CHEF_ROLE_ID);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        
        // If targeting someone else, check admin permissions
        if (targetUser.id !== interaction.user.id && !hasAdminRole && !isAdmin) {
            return interaction.reply({ 
                content: 'You can only change your own status unless you have admin permissions!', 
                ephemeral: true 
            });
        }
        
        if (!hasChefRole && !hasAdminRole && !isAdmin && targetUser.id === interaction.user.id) {
            return interaction.reply({ 
                content: 'You need the chef role to use this command!', 
                ephemeral: true 
            });
        }

        try {
            // Add chef to database if not exists
            await db.addChef(targetUser.id, targetUser.username);
            
            // Update chef status
            await db.updateChefStatus(targetUser.id, status);
            
            // If setting to CLOSED and chef has active tickets, hide those channels
            if (status === 'CLOSED') {
                const activeTickets = Array.from(client.activeTickets.entries())
                    .filter(([channelId, ticket]) => ticket.chefId === targetUser.id);
                
                for (const [channelId, ticket] of activeTickets) {
                    const channel = client.channels.cache.get(channelId);
                    if (channel) {
                        await channel.permissionOverwrites.edit(ticket.userId, {
                            ViewChannel: false
                        });
                        
                        const embed = new EmbedBuilder()
                            .setTitle('🔒 Ticket Temporarily Hidden')
                            .setDescription('Your assigned chef is currently offline. This ticket will reappear when they come back online.')
                            .setColor('#00ADEF')
                            .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
                            .setTimestamp();
                            
                        await channel.send({ embeds: [embed] });
                    }
                }
            } else if (status === 'OPEN') {
                // If setting to OPEN, show hidden tickets
                const activeTickets = Array.from(client.activeTickets.entries())
                    .filter(([channelId, ticket]) => ticket.chefId === targetUser.id);
                
                for (const [channelId, ticket] of activeTickets) {
                    const channel = client.channels.cache.get(channelId);
                    if (channel) {
                        await channel.permissionOverwrites.edit(ticket.userId, {
                            ViewChannel: true,
                            SendMessages: true
                        });
                        
                        const embed = new EmbedBuilder()
                            .setTitle('✅ Ticket Restored')
                            .setDescription('Your chef is back online! You can continue with your order.')
                            .setColor('#00ADEF')
                            .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
                            .setTimestamp();
                            
                        await channel.send({ embeds: [embed] });
                    }
                }
            }
            
            // Rename status channel based on chef availability
            try {
                const guild = interaction.guild;
                const statusChannel = guild.channels.cache.get(process.env.STATUS_CHANNEL_ID);
                if (statusChannel) {
                    const allChefs = await db.getAllChefs();
                    const openChefs = allChefs.filter(chef => chef.status === 'OPEN');
                    
                    if (openChefs.length > 0) {
                        await statusChannel.setName('🟢-status');
                    } else {
                        await statusChannel.setName('🔴-status');
                    }
                }
            } catch (error) {
                console.log('Could not rename status channel:', error.message);
            }
            
            // Update the chef status embed
            await client.utils.updateChefStatusEmbed();
            
            const statusEmojis = {
                'OPEN': '🟢',
                'BUSY': '🟡',
                'CLOSED': '🔴'
            };
            
            const embed = new EmbedBuilder()
                .setTitle('Chef Status Updated')
                .setDescription(`${statusEmojis[status]} ${targetUser.username}'s status has been set to **${status}**`)
                .setColor('#00ADEF')
                .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error updating chef status:', error);
            await interaction.reply({ 
                content: 'There was an error updating the chef status!', 
                ephemeral: true 
            });
        }
    },
};