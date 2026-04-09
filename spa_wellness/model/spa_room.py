# -*- coding: utf-8 -*-
from odoo import api, fields, models

class SpaRoom(models.Model):
    _name = 'spa.room'
    _description = 'Spa Room'
    _inherit = ['mail.thread']

    name = fields.Char('Room Name', required=True)
    code = fields.Char('Room Code')
    branch_id = fields.Many2one('res.company', string='Branch')
    room_type = fields.Selection([
        ('single', 'Single'),
        ('couple', 'Couple'),
        ('group', 'Group'),
        ('vip', 'VIP'),
    ], required=True, default='single')
    capacity = fields.Integer('Capacity', default=1)
    status = fields.Selection([
        ('available', 'Available'),
        ('occupied', 'Occupied'),
        ('maintenance', 'Under Maintenance'),
        ('cleaning', 'Cleaning'),
    ], default='available', tracking=True)
    active = fields.Boolean(default=True)
    notes = fields.Text('Notes')
    color = fields.Integer('Calendar Color')

    def action_set_maintenance(self):
        self.status = 'maintenance'

    def action_set_available(self):
        self.status = 'available'