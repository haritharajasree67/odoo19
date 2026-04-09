# -*- coding: utf-8 -*-
from odoo import api, fields, models

class SpaTherapist(models.Model):
    _name = 'spa.therapist'
    _description = 'Spa Therapist'
    _inherit = ['mail.thread', 'mail.activity.mixin']

    name = fields.Char('Therapist Name', required=True, tracking=True)
    employee_id = fields.Many2one('hr.employee', string='Linked Employee')
    user_id = fields.Many2one('res.users', string='Portal/User Account')
    branch_id = fields.Many2one('res.company', string='Branch')
    active = fields.Boolean(default=True)
    mobile = fields.Char('Mobile')
    email = fields.Char('Email')
    color = fields.Integer('Calendar Color')
    image = fields.Image('Photo')

    # Skills
    skill_ids = fields.Many2many('spa.service', string='Commission Services')
    specialization = fields.Char('Specialization')

    # Targets & Performance
    monthly_target = fields.Monetary('Monthly Sales Target', currency_field='currency_id')
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)

    # Commission slab lines
    commission_slab_ids = fields.One2many(
        'spa.commission.slab', 'therapist_id', string='Commission Slabs'
    )

    # Working hours
    resource_calendar_id = fields.Many2one(
        'resource.calendar', string='Working Hours',
        related='employee_id.resource_calendar_id', store=True
    )

    appointment_ids = fields.One2many(
        'spa.appointment', 'therapist_id', string='Appointments'
    )

    def _is_available(self, start_dt, end_dt):
        """Check if therapist has no overlapping confirmed appointments."""
        overlapping = self.env['spa.appointment'].search([
            ('therapist_id', '=', self.id),
            ('state', 'in', ['confirmed', 'draft']),
            ('start_datetime', '<', end_dt),
            ('end_datetime', '>', start_dt),
        ])
        return not bool(overlapping)