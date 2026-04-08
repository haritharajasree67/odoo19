# Part of Odoo. See LICENSE file for full copyright and licensing details.

from odoo import fields, models, _
from odoo.exceptions import UserError



class AccountMoveLine(models.Model):
    _inherit = 'account.move.line'

    def action_reconcile(self):
        """ This function is called by the 'Reconcile' button of account.move.line's
        list view. It performs reconciliation between the selected lines.
        - If the reconciliation can be done directly we do it silently
        - Else, if a write-off is required we open the wizard to let the client enter required information
        """
        wizard = self.env['account.reconcile.wizard'].with_context(
            active_model='account.move.line',
            active_ids=self.ids,
        ).new({})
        return wizard._action_open_wizard() if (
                    wizard.is_write_off_required or wizard.force_partials) else wizard.reconcile()

    def _action_open_wizard(self):
        self.ensure_one()
        return {
            'name': _('Write-Off Entry'),
            'type': 'ir.actions.act_window',
            'view_type': 'form',
            'view_mode': 'form',
            'res_model': 'account.reconcile.wizard',
            'res_id': self.id,
            'target': 'new',
        }
