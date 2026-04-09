from odoo import models, fields

class AccountMove(models.Model):
    _inherit = 'account.move'

    spa_appointment_id = fields.Many2one(
        'spa.appointment',
        string="Spa Appointment",
        readonly=True,
        copy=False
    )
class StockPicking(models.Model):
    _inherit = 'stock.picking'

    spa_appointment_ids = fields.Many2one(
        'spa.appointment',
        string="Spa Appointment",
        ondelete='set null'
    )