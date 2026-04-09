# -*- coding: utf-8 -*-
from odoo import api, fields, models, _

class SpaPackageTemplate(models.Model):
    _name = 'spa.package.template'
    _description = 'Spa Package Template'

    name = fields.Char('Package Name', required=True)
    price = fields.Monetary('Package Price', currency_field='currency_id')
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)
    validity_days = fields.Integer('Validity (Days)', default=365)
    line_ids = fields.One2many('spa.package.template.line', 'package_id', string='Services Included')
    active = fields.Boolean(default=True)

class SpaPackageTemplateLine(models.Model):
    _name = 'spa.package.template.line'
    _description = 'Package Template Service Line'

    package_id = fields.Many2one('spa.package.template', ondelete='cascade')
    service_id = fields.Many2one('spa.service', string='Service', required=True)
    sessions = fields.Integer('Sessions', default=1)

