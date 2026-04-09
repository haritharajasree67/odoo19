from odoo import models, fields, api


class SpaMembershipPlan(models.Model):
    _name = 'spa.membership.plan'
    _description = 'Spa Membership Plan'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _rec_name = 'name'

    # -----------------------
    # Basic Info
    # -----------------------
    name = fields.Char(
        string="Membership Plan Name",
        required=True,
        tracking=True
    )

    active = fields.Boolean(default=True)

    # -----------------------
    # Duration
    # -----------------------
    duration = fields.Integer(string="Duration")

    duration_type = fields.Selection([
        ('days', 'Days'),
        ('months', 'Months'),
        ('years', 'Years')
    ], default='months', required=True)

    # -----------------------
    # Service Lines
    # -----------------------
    service_line_ids = fields.One2many(
        'spa.membership.plan.service',
        'membership_id',
        string="Services"
    )

    # -----------------------
    # Product Discount Lines
    # -----------------------
    product_line_ids = fields.One2many(
        'spa.membership.plan.product',
        'membership_id',
        string="Product Discounts"
    )

    # -----------------------
    consultation_count = fields.Integer(
        string="Consultation Count"
    )

    price = fields.Float(string="Membership Price")

    note = fields.Text(string="Description")


class SpaMembershipPlanService(models.Model):
    _name = 'spa.membership.plan.service'
    _description = 'Membership Allowed Services'

    membership_id = fields.Many2one(
        'spa.membership.plan',
        ondelete='cascade'
    )

    service_id = fields.Many2one(
        'spa.service',
        string="Service",
        required=True
    )

    allowed_sessions = fields.Integer(
        string="Allowed Sessions",
        default=1
    )

    discount_percentage = fields.Float(
        string="Discount (%)"
    )

class SpaMembershipPlanProduct(models.Model):
    _name = 'spa.membership.plan.product'
    _description = 'Membership Product Discount'

    membership_id = fields.Many2one(
        'spa.membership.plan',
        ondelete='cascade'
    )

    product_id = fields.Many2one(
        'product.product',
        string="Product",
        required=True
    )

    discount_percentage = fields.Float(
        string="Discount (%)",
        required=True
    )