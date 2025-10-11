const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-status')
        .setDescription('Send the chef status embed (Admin only)'),
    
    async execute(interaction, client, db) {
        // Check admin permissions
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasAdminRole = member.roles.cache.has(process.env.ADMIN_ROLE_ID);
        const isAdmin = member.permissions.has('Administrator');
        
        if (!hasAdminRole && !isAdmin) {
            return interaction.reply({ 
                content: 'You need admin permissions to use this command!', 
                ephemeral: true 
            });
        }
        
        // Update and send the chef status embed
        await client.utils.updateChefStatusEmbed();
        
        await interaction.reply({ 
            content: 'Chef status embed has been updated!', 
            ephemeral: true 
        });
    },
};