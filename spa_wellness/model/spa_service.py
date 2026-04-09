# -*- coding: utf-8 -*-
from odoo import api, fields, models

class SpaServiceCategory(models.Model):
    _name = 'spa.service.category'
    _description = 'Spa Service Category'

    name = fields.Char('Category Name', required=True)
    active = fields.Boolean(default=True)
    color = fields.Integer('Color Index')

class SpaService(models.Model):
    _name = 'spa.service'
    _description = 'Spa Service'
    _inherit = ['mail.thread', 'mail.activity.mixin']

    name = fields.Char('Service Name', required=True, tracking=True)
    category_id = fields.Many2one('spa.service.category', string='Category', )
    duration = fields.Float('Duration (mins)', required=True)
    service_charge = fields.Monetary('Service Charge', currency_field='currency_id')
    price = fields.Monetary('Total Price', currency_field='currency_id',compute='_compute_total_price',)
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)
    active = fields.Boolean(default=True)
    description = fields.Text('Description')
    is_commission = fields.Boolean("Allow Commission")

    # Room requirements
    room_type = fields.Selection([
        ('single', 'Single Room'),
        ('couple', 'Couple Room'),
        ('group', 'Group Room'),
        ('any', 'Any'),
    ], default='any', string='Room Type Required')

    # Commission Rules
    commission_type = fields.Selection([
        ('percentage', 'Percentage'),
        ('fixed', 'Fixed Amount'),
        ('slab', 'Slab Based'),
    ], default='percentage', string='Commission Type')
    commission_value = fields.Float('Commission Value (%/Fixed)')

    # Consumables
    consumable_ids = fields.One2many(
        'spa.service.consumable', 'service_id', string='Consumables Used'
    )



    @api.depends(
        'service_charge',
        'consumable_ids.total_amount'
    )
    def _compute_total_price(self):
        for rec in self:
            consumable_total = sum(
                rec.consumable_ids.mapped('total_amount')
            )
            rec.price = rec.service_charge + consumable_total

class SpaServiceConsumable(models.Model):
    _name = 'spa.service.consumable'
    _description = 'Spa Service Consumable'

    service_id = fields.Many2one('spa.service', string='Service', ondelete='cascade')
    product_id = fields.Many2one(
        'product.product', string='Product/Material', required=True,
        domain=[('type', 'in', ['product', 'consu'])]
    )
    quantity = fields.Float('Quantity Used', default=1.0, required=True)
    uom_id = fields.Many2one('uom.uom', string='Unit of Measure')
    # ✅ Currency
    currency_id = fields.Many2one(
        'res.currency',
        default=lambda self: self.env.company.currency_id,
        readonly=True
    )

    # ✅ Product Unit Price
    product_price = fields.Monetary(
        string="Unit Price",
        currency_field="currency_id",
        compute="_compute_price",
        store=True
    )

    # ✅ Total Amount
    total_amount = fields.Monetary(
        string="Total",
        currency_field="currency_id",
        compute="_compute_price",
        store=True
    )

    # -------------------------------------------------------
    # COMPUTE
    # -------------------------------------------------------
    @api.depends('product_id', 'quantity')
    def _compute_price(self):
        for rec in self:
            price = rec.product_id.list_price or 0.0
            rec.product_price = price
            rec.total_amount = price * rec.quantity
