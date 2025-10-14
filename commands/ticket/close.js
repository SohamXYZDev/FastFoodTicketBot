const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for closing the ticket')
                .setRequired(false)),
    
    async execute(interaction, client, db) {
        const channelId = interaction.channel.id;
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        // Check if this is a ticket channel
        if (!client.activeTickets.has(channelId)) {
            return interaction.reply({ 
                content: 'This command can only be used in ticket channels!', 
                ephemeral: true 
            });
        }
        
        const ticket = client.activeTickets.get(channelId);
        
        // Check permissions - customer, assigned chef, or admin
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        const isCustomer = ticket.userId === interaction.user.id;
        const isAssignedChef = ticket.chefId === interaction.user.id;
        
        if (!isCustomer && !isAssignedChef && !hasAdminRole && !isAdmin) {
            return interaction.reply({ 
                content: 'You can only close your own tickets or tickets you are assigned to!', 
                ephemeral: true 
            });
        }
        
        try {
            // Create closure embed
            const embed = new EmbedBuilder()
                .setTitle('🔒 Ticket Closed')
                .setDescription(`Ticket closed by <@${interaction.user.id}>`)
                .setColor('#00ADEF')
                .setThumbnail('https://media.discordapp.net/attachments/1424068610355363963/1427324660810256474/ChatGPT_Image_Oct_13_2025_03_11_27_AM.png')
                .addFields(
                    { name: '📝 Reason', value: reason, inline: false },
                    { name: '⏰ Closed At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: '🎫 Ticket Type', value: ticket.orderType, inline: true },
                    { name: '✅ Completed', value: ticket.completed ? 'Yes' : 'No', inline: true }
                )
                .setFooter({ text: 'This channel will be deleted in 10 seconds' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed] });
            
            // Remove from active tickets
            client.activeTickets.delete(channelId);
            
            // Check if chef should be set back to OPEN
            if (!ticket.completed) {
                const chefTickets = Array.from(client.activeTickets.values())
                    .filter(t => t.chefId === ticket.chefId);
                
                if (chefTickets.length === 0) {
                    await db.updateChefStatus(ticket.chefId, 'OPEN');
                    await client.utils.updateChefStatusEmbed();
                }
            }
            
            // Delete channel after delay
            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    console.error('Error deleting channel:', error);
                }
            }, 10000);
            
        } catch (error) {
            console.error('Error closing ticket:', error);
            await interaction.reply({ 
                content: 'There was an error closing the ticket!', 
                ephemeral: true 
            });
        }
    },
};