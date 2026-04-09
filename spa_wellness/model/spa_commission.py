# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import UserError

class SpaCommissionSlab(models.Model):
    _name = 'spa.commission.slab'
    _description = 'Commission Slab Rule'

    therapist_id = fields.Many2one('spa.therapist', string='Therapist')
    min_sales = fields.Monetary('Min Sales', currency_field='currency_id')
    max_sales = fields.Monetary('Max Sales', currency_field='currency_id')
    commission_rate = fields.Float('Commission Rate (%)')
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)

class SpaCommission(models.Model):
    _name = 'spa.commission'
    _description = 'Therapist Commission'
    _inherit = ['mail.thread']
    _order = 'date desc'

    name = fields.Char('Reference', readonly=True, default='New', copy=False)
    therapist_id = fields.Many2one('spa.therapist', string='Therapist', required=True)
    appointment_id = fields.Many2one('spa.appointment', string='Appointment')
    service_id = fields.Many2one('spa.service', string='Service')
    date = fields.Date('Date', default=fields.Date.today)
    month = fields.Char('Month', compute='_compute_month', store=True)

    commission_type = fields.Selection([
        ('percentage', 'Percentage'),
        ('fixed', 'Fixed Amount'),
        ('slab', 'Slab Based'),
        ('product', 'Product Incentive'),
    ], default='percentage')

    sale_amount = fields.Monetary('Sale Amount', currency_field='currency_id')
    commission_amount = fields.Monetary('Commission Amount', currency_field='currency_id', tracking=True)
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)

    state = fields.Selection([
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('paid', 'Paid'),
        ('rejected', 'Rejected'),
    ], default='pending', tracking=True)

    approved_by = fields.Many2one('res.users', string='Approved By', readonly=True)
    approved_date = fields.Datetime('Approved On', readonly=True)
    notes = fields.Text('Notes')

    @api.depends('date')
    def _compute_month(self):
        for rec in self:
            rec.month = rec.date.strftime('%Y-%m') if rec.date else ''

    def action_approve(self):
        for rec in self:
            if rec.state != 'pending':
                raise UserError(_('Only pending commissions can be approved.'))
            rec.state = 'approved'
            rec.approved_by = self.env.user
            rec.approved_date = fields.Datetime.now()

    def action_reject(self):
        self.state = 'rejected'

    def action_mark_paid(self):
        for rec in self:
            if rec.state != 'approved':
                raise UserError(_('Only approved commissions can be marked as paid.'))
            rec.state = 'paid'

    @api.model
    def create(self, vals):
        if vals.get('name', 'New') == 'New':
            vals['name'] = self.env['ir.sequence'].next_by_code('spa.commission') or 'New'
        return super().create(vals)