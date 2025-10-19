const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletetickets')
        .setDescription('Delete all active ticket channels and clear ticket data')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction, client, db) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const guild = interaction.guild;
            let deletedCount = 0;
            let failedCount = 0;
            const failedChannels = [];

            // Get all active tickets from memory
            const ticketChannels = Array.from(client.activeTickets.keys());

            if (ticketChannels.length === 0) {
                return interaction.editReply({ content: '❌ No active tickets found to delete.' });
            }

            const confirmEmbed = new EmbedBuilder()
                .setTitle('⚠️ Delete All Tickets')
                .setDescription(`Found **${ticketChannels.length}** active ticket(s).\n\nDeleting channels...`)
                .setColor('#FF6B35')
                .setTimestamp();

            await interaction.editReply({ embeds: [confirmEmbed] });

            // Delete each ticket channel
            for (const channelId of ticketChannels) {
                try {
                    const channel = guild.channels.cache.get(channelId);
                    if (channel) {
                        await channel.delete('Mass ticket deletion by admin');
                        deletedCount++;
                    } else {
                        // Channel doesn't exist, just remove from database and memory
                        client.activeTickets.delete(channelId);
                        await db.deleteActiveTicket(channelId);
                        deletedCount++;
                    }
                } catch (error) {
                    console.error(`Failed to delete channel ${channelId}:`, error);
                    failedCount++;
                    failedChannels.push(channelId);
                }
            }

            // Clear all tickets from database
            const allTickets = await db.getAllActiveTickets();
            for (const ticket of allTickets) {
                await db.deleteActiveTicket(ticket.channel_id);
            }

            // Clear memory
            client.activeTickets.clear();

            // Update all chef statuses to OPEN
            const chefs = await db.getAllChefs();
            for (const chef of chefs) {
                if (chef.status !== 'CLOSED') {
                    await db.updateChefStatus(chef.user_id, 'OPEN');
                }
            }

            // Update chef status embed
            await client.utils.updateChefStatusEmbed();

            // Send completion message
            const resultEmbed = new EmbedBuilder()
                .setTitle('✅ Ticket Deletion Complete')
                .setColor('#00ADEF')
                .setThumbnail('https://i.ibb.co/fYkrgwKy/Chat-GPT-Image-Oct-13-2025-12-09-59-PM.png')
                .addFields(
                    { name: '✅ Deleted', value: `${deletedCount}`, inline: true },
                    { name: '❌ Failed', value: `${failedCount}`, inline: true },
                    { name: '📊 Total', value: `${ticketChannels.length}`, inline: true }
                )
                .setFooter({ text: 'All active tickets have been cleared' })
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
