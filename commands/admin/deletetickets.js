const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletetickets')
        .setDescription('Delete ticket channels and clear ticket data')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of tickets to delete')
                .setRequired(true)
                .addChoices(
                    { name: 'Active Tickets Only', value: 'active' },
                    { name: 'Completed Tickets Only', value: 'completed' },
                    { name: 'All Tickets (Active + Completed)', value: 'all' }
                )),
    
    async execute(interaction, client, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            const deleteType = interaction.options.getString('type');
            let deletedCount = 0;
            let failedCount = 0;
            const failedChannels = [];
            const channelsToDelete = [];

            // Determine which channels to delete based on type
            if (deleteType === 'active' || deleteType === 'all') {
                // Get all active tickets from memory
                const activeTicketChannels = Array.from(client.activeTickets.keys());
                channelsToDelete.push(...activeTicketChannels);
            }

            if (deleteType === 'completed' || deleteType === 'all') {
                // Get completed tickets from the completed category
                const completedCategoryId = '1427368396197990550';
                const completedCategory = guild.channels.cache.get(completedCategoryId);
                
                if (completedCategory && completedCategory.children) {
                    const completedChannels = completedCategory.children.cache
                        .filter(channel => channel.name.startsWith('completed-'))
                        .map(channel => channel.id);
                    channelsToDelete.push(...completedChannels);
                }
            }

            // Remove duplicates
            const uniqueChannels = [...new Set(channelsToDelete)];

            if (uniqueChannels.length === 0) {
                return interaction.editReply({ content: `❌ No ${deleteType} tickets found to delete.` });
            }

            const typeLabel = deleteType === 'active' ? 'active' : deleteType === 'completed' ? 'completed' : 'active and completed';
            const confirmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Delete Tickets')
                .setDescription(`Found **${uniqueChannels.length}** ${typeLabel} ticket(s).\n\nDeleting channels...`)
                .setColor('#FF6B35')
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            // Delete each ticket channel
            for (const channelId of uniqueChannels) {
                try {
                    const channel = guild.channels.cache.get(channelId);
                    if (channel) {
                        await channel.delete('Mass ticket deletion by admin');
                        deletedCount++;
                    } else {
                        // Channel doesn't exist, just remove from database and memory
                        if (client.activeTickets.has(channelId)) {
                            client.activeTickets.delete(channelId);
                            await db.deleteActiveTicket(channelId);
                        }
                        deletedCount++;
                    }
                    
                    // Small delay to avoid rate limits
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`Failed to delete channel ${channelId}:`, error);
                    failedCount++;
                    failedChannels.push(channelId);
                }
            }

            // Clear active tickets from database and memory if deleting active tickets
            if (deleteType === 'active' || deleteType === 'all') {
                const allTickets = await db.getAllActiveTickets();
                for (const ticket of allTickets) {
                    await db.deleteActiveTicket(ticket.channel_id);
                }
                client.activeTickets.clear();
            }

            // Update all chef statuses to OPEN if we deleted active tickets
            if (deleteType === 'active' || deleteType === 'all') {
                const chefs = await db.getAllChefs();
                for (const chef of chefs) {
                    if (chef.status !== 'CLOSED') {
                        await db.updateChefStatus(chef.user_id, 'OPEN');
                    }
                }

                // Update chef status embed
                await client.utils.updateChefStatusEmbed();
            }

            // Send completion message
            const resultEmbed = new EmbedBuilder()
                .setTitle('✅ Ticket Deletion Complete')
                .setColor('#00ADEF')
                .setThumbnail('https://i.ibb.co/fYkrgwKy/Chat-GPT-Image-Oct-13-2025-12-09-59-PM.png')
                .addFields(
                    { name: '✅ Deleted', value: `${deletedCount}`, inline: true },
                    { name: '❌ Failed', value: `${failedCount}`, inline: true },
                    { name: '📊 Total', value: `${uniqueChannels.length}`, inline: true }
                )
                .setFooter({ text: `All ${typeLabel} tickets have been cleared` })
                .setTimestamp();

            if (failedChannels.length > 0) {
                resultEmbed.addFields({
                    name: '⚠️ Failed Channels',
                    value: failedChannels.map(id => `<#${id}>`).join('\n') || 'None',
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [resultEmbed] });

        } catch (error) {
            console.error('Error deleting tickets:', error);
            await interaction.editReply({ 
                content: '❌ An error occurred while deleting tickets. Check console for details.',
                embeds: []
            });
        }
    },
};
