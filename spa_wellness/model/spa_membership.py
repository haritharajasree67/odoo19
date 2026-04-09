# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import UserError

class SpaMembership(models.Model):
    _name = 'spa.membership'
    _description = 'Spa Membership'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'date_start desc'

    color = fields.Integer(string="Color Index")

    name = fields.Char('Membership Reference', readonly=True, default='New')
    partner_id = fields.Many2one('res.partner', string='Customer', required=True, tracking=True)
    membership_type = fields.Selection([

        ('monthly', 'Monthly'),
        ('annual', 'Annual'),
    ], required=True, string='Membership Type')

    membership_plan = fields.Many2one('spa.membership.plan',string='Membership Plan')
    membership_price = fields.Float(
        string='Membership Price',
        related='membership_plan.price',
        store=True,
        readonly=True,
    )

    date_start = fields.Date('Start Date', required=True, default=fields.Date.today)
    date_end = fields.Date('End Date')

    # Credits / Wallet
    total_credits = fields.Float('Total Credits/Sessions')
    used_credits = fields.Float('Used Credits/Sessions', readonly=True)
    remaining_credits = fields.Float('Remaining Credits', compute='_compute_remaining', store=True)

    # Wallet
    wallet_balance = fields.Monetary('Wallet Balance', currency_field='currency_id')
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)

    state = fields.Selection([
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('expired', 'Expired'),
        ('cancelled', 'Cancelled'),
    ], default='draft', tracking=True)

    invoice_id = fields.Many2one('account.move', string='Membership Invoice')
    service_ids = fields.Many2many('spa.service', string='Covered Services')
    notes = fields.Text('Notes')

    service_line_ids = fields.One2many(
        'spa.membership.service',
        'membership_id',
        string="Services"
    )

    product_line_ids = fields.One2many(
        'spa.membership.product',
        'membership_id',
        string="Product Discounts"
    )

    @api.onchange('membership_plan')
    def _onchange_membership_plan(self):
        for rec in self:

            if not rec.membership_plan:
                rec.service_line_ids = [(5, 0, 0)]
                rec.product_line_ids = [(5, 0, 0)]
                return

            service_lines = []
            product_lines = []

            # ----------------------------
            # FETCH SERVICES FROM PLAN
            # ----------------------------
            for line in rec.membership_plan.service_line_ids:
                service_lines.append((0, 0, {
                    'service_id': line.service_id.id,
                    'allowed_sessions': line.allowed_sessions,
                    'discount_percentage': line.discount_percentage,
                }))

            # ----------------------------
            # FETCH PRODUCTS FROM PLAN
            # ----------------------------
            for line in rec.membership_plan.product_line_ids:
                product_lines.append((0, 0, {
                    'product_id': line.product_id.id,
                    'discount_percentage': line.discount_percentage,
                }))

            rec.service_line_ids = [(5, 0, 0)] + service_lines
            rec.product_line_ids = [(5, 0, 0)] + product_lines

    def action_create_invoice(self):
        self.ensure_one()

        if not self.partner_id:
            raise UserError(_("Customer is required."))

        if not self.membership_plan:
            raise UserError(_("Membership plan product is required."))

        if self.invoice_id:
            raise UserError(_("Invoice already created."))

        mem_product = self.env['product.product'].search(
            [('name', '=', 'Membership Plan')], limit=1
        )

        invoice_vals = {
            'move_type': 'out_invoice',
            'partner_id': self.partner_id.id,
            'invoice_origin': self.name,
            'invoice_line_ids': [(0, 0, {
                'product_id': mem_product.id,
                'name': self.membership_plan.name,  # description
                'quantity': 1,
                'price_unit': self.membership_price,
            })],
        }

        invoice = self.env['account.move'].create(invoice_vals)

        # store invoice reference
        self.invoice_id = invoice.id

        # open invoice form
        return {
            'type': 'ir.actions.act_window',
            'name': _('Customer Invoice'),
            'res_model': 'account.move',
            'view_mode': 'form',
            'res_id': invoice.id,
        }

    @api.depends('total_credits', 'used_credits')
    def _compute_remaining(self):
        for rec in self:
            rec.remaining_credits = rec.total_credits - rec.used_credits

    def action_activate(self):
        self.state = 'active'

    def action_expire(self):
        self.state = 'expired'

    def action_cancel(self):
        self.state = 'cancelled'

    def redeem_credit(self, qty=1):
        for rec in self:
            if rec.remaining_credits < qty:
                raise UserError(_('Insufficient credits on membership %s.') % rec.name)
            rec.used_credits += qty

    def redeem_wallet(self, amount):
        for rec in self:
            if rec.wallet_balance < amount:
                raise UserError(_('Insufficient wallet balance on membership %s.') % rec.name)
            rec.wallet_balance -= amount

    @api.model
    def create(self, vals):
        if vals.get('name', 'New') == 'New':
            vals['name'] = self.env['ir.sequence'].next_by_code('spa.membership') or 'New'
        return super().create(vals)

    @api.model
    def _cron_check_expiry(self):
        """Scheduled action: auto-expire memberships past end date."""
        expired = self.search([
            ('state', '=', 'active'),
            ('date_end', '<', fields.Date.today()),
        ])
        expired.write({'state': 'expired'})
        # Send expiry notifications
        for rec in expired:
            rec.message_post(body=_('Membership has expired.'))

class SpaMembershipService(models.Model):
    _name = 'spa.membership.service'
    _description = 'Membership Service'

    membership_id = fields.Many2one(
        'spa.membership',
        ondelete='cascade'
    )

    service_id = fields.Many2one(
        'spa.service',
        required=True
    )

    allowed_sessions = fields.Integer(default=1)
    used_sessions = fields.Integer(default=0)

    discount_percentage = fields.Float(string="Discount (%)")

class SpaMembershipProduct(models.Model):
    _name = 'spa.membership.product'
    _description = 'Membership Product Discount'

    membership_id = fields.Many2one(
        'spa.membership',
        ondelete='cascade'
    )

    product_id = fields.Many2one(
        'product.product',
        required=True
    )

    discount_percentage = fields.Float()