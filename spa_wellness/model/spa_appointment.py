# # -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.exceptions import ValidationError, UserError
from datetime import timedelta

class SpaAppointment(models.Model):
    _name = 'spa.appointment'
    _description = 'Spa Appointment'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'start_datetime desc'

    # ── Identifiers ──────────────────────────────────────────────
    name = fields.Char('Reference', readonly=True, default='New', copy=False)
    branch_id = fields.Many2one('res.company', string='Branch', default=lambda self: self.env.company)

    # ── Customer ─────────────────────────────────────────────────
    partner_id = fields.Many2one('res.partner', string='Customer',  tracking=True)
    mobile = fields.Char(string='Mobile')
    membership_id = fields.Many2one(
        'spa.membership', string='Active Membership',
        domain="[('partner_id','=',partner_id),('state','=','active')]"
    )
    package_id = fields.Many2one(
        'spa.package.template', string='Package',

    )


    duration = fields.Float('Duration (mins)',  store=True)
    price = fields.Monetary('Service Price', currency_field='currency_id')
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)

    # ── Scheduling ────────────────────────────────────────────────
    start_datetime = fields.Datetime('Start Time', tracking=True)
    end_datetime = fields.Datetime('End Time',)
    therapist_id = fields.Many2one('spa.therapist', string='Therapist', tracking=True)
    room_id = fields.Many2one('spa.room', string='Room', tracking=True)

    # ── State ─────────────────────────────────────────────────────
    state = fields.Selection([
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
        ('no_show', 'No Show'),
    ], default='draft', tracking=True, string='Status')

    consumable_line_ids = fields.One2many(
        'spa.appointment.consumable',
        'appointment_id',
        string="Consumables"
    )

    # ── Billing ───────────────────────────────────────────────────
    payment_method = fields.Selection([
        ('cash', 'Cash'),
        ('card', 'Card'),
        ('online', 'Online'),
        ('wallet', 'Wallet'),
        ('membership', 'Membership Credit'),
        ('package', 'Prepaid Package'),
        ('split', 'Split Payment'),
    ], string='Payment Method')
    sale_order_id = fields.Many2one('sale.order', string='Sale Order', readonly=True)
    invoice_id = fields.Many2one('account.move', string='Invoice', readonly=True)
    is_invoiced = fields.Boolean('Invoiced', compute='_compute_is_invoiced', store=True)

    invoice_count = fields.Integer(
        string="Invoices",
        compute="_compute_invoice_count"
    )

    company_id = fields.Many2one(
        'res.company',
        string='Company',
        required=True,
        default=lambda self: self.env.company,
        index=True
    )

    # ── Commission ────────────────────────────────────────────────
    commission_id = fields.Many2one('spa.commission', string='Commission Record', readonly=True)

    # ── Notes ─────────────────────────────────────────────────────
    notes = fields.Text('Internal Notes')
    customer_notes = fields.Text('Customer Preferences')

    # ─────────────────────────────────────────────────────────────
    # COMPUTED
    # ─────────────────────────────────────────────────────────────

    service_charge = fields.Monetary(
        string="Service Charge",
        currency_field="currency_id",
        compute="_compute_prices",
        store=True
    )

    # ✅ Consumable total
    consumable_total = fields.Monetary(
        string="Consumables Total",
        currency_field="currency_id",
        compute="_compute_prices",
        store=True
    )

    # ✅ Final appointment price
    total_price = fields.Monetary(
        string="Total Price",
        currency_field="currency_id",
        compute="_compute_prices",
        store=True
    )

    delivery_ids = fields.One2many(
        'stock.picking',
        'spa_appointment_ids',
        string="Deliveries"
    )

    delivery_count = fields.Integer(
        compute="_compute_delivery_count",
        string="Deliveries"
    )


    commission_ids = fields.One2many(
        'spa.therapist.commission',
        'appointment_id',
        string="Therapist Commissions"
    )

    service_line_ids = fields.One2many(
        'spa.appointment.service',
        'appointment_id',
        string="Services"
    )

    @api.onchange('package_id')
    def _onchange_package_id(self):
        for rec in self:

            # Remove existing services when package changes
            rec.service_line_ids = [(5, 0, 0)]

            if not rec.package_id:
                return

            service_lines = []

            for line in rec.package_id.line_ids:
                service = line.service_id

                service_lines.append((0, 0, {
                    'service_id': service.id,

                    'service_charge': service.service_charge or 0.0,
                }))

            rec.service_line_ids = service_lines

    def _compute_delivery_count(self):
        for rec in self:
            rec.delivery_count = len(rec.delivery_ids)

    def action_view_deliveries(self):
        self.ensure_one()

        action = self.env.ref('stock.action_picking_tree_all').read()[0]

        action['domain'] = [('spa_appointment_ids', '=', self.id)]
        action['context'] = {'default_spa_appointment_ids': self.id}

        return action

    @api.depends(
        'package_id',
        'service_line_ids.service_charge',
        'consumable_line_ids.total_amount',
        'consumable_line_ids.product_id'
    )
    def _compute_prices(self):
        for rec in self:

            print("\n==== COMPUTE PRICE START ====")

            # ------------------------------------------------
            # CASE 1 : PACKAGE EXISTS
            # ------------------------------------------------
            if rec.package_id:
                print("Package detected:", rec.package_id.name)

                # ✅ Package amount becomes service charge
                service_total = rec.package_id.price or 0.0
                print("Package price:", service_total)

                # --------------------------------------------
                # Collect products included in package
                # --------------------------------------------
                package_products = set()

                for pkg_service in rec.package_id.line_ids:
                    service = pkg_service.service_id

                    products = service.consumable_ids.mapped('product_id.id')
                    package_products.update(products)

                print("Products included in package:", package_products)

                # --------------------------------------------
                # Add ONLY extra consumables
                # --------------------------------------------
                consumable_total = 0.0

                for line in rec.consumable_line_ids:
                    if line.product_id.id not in package_products:
                        print(
                            f"Extra consumable added: {line.product_id.name} "
                            f"Amount: {line.total_amount}"
                        )
                        consumable_total += line.total_amount
                    else:
                        print(
                            f"Skipped package consumable: {line.product_id.name}"
                        )

            # ------------------------------------------------
            # CASE 2 : NORMAL APPOINTMENT (NO PACKAGE)
            # ------------------------------------------------
            else:
                print("No package — normal calculation")

                service_total = sum(
                    rec.service_line_ids.mapped('service_charge')
                )

                consumable_total = sum(
                    rec.consumable_line_ids.mapped('total_amount')
                )

            # ------------------------------------------------
            # FINAL VALUES
            # ------------------------------------------------
            rec.service_charge = service_total
            rec.consumable_total = consumable_total
            rec.total_price = service_total + consumable_total

            print("Service Total:", service_total)
            print("Consumable Total:", consumable_total)
            print("Grand Total:", rec.total_price)
            print("==== COMPUTE PRICE END ====\n")

    # @api.depends(
    #     'service_line_ids.service_charge',
    #     'consumable_line_ids.total_amount'
    # )
    # def _compute_prices(self):
    #     for rec in self:
    #         service_total = sum(
    #             rec.service_line_ids.mapped('service_charge')
    #         )
    #
    #         consumable_total = sum(
    #             rec.consumable_line_ids.mapped('total_amount')
    #         )
    #
    #         rec.service_charge = service_total
    #         rec.consumable_total = consumable_total
    #         rec.total_price = service_total + consumable_total

    def _compute_invoice_count(self):
        for rec in self:
            rec.invoice_count = self.env['account.move'].search_count([
                ('spa_appointment_id', '=', rec.id),
                ('move_type', '=', 'out_invoice'),
            ])

    def action_view_invoices(self):
        self.ensure_one()

        return {
            'type': 'ir.actions.act_window',
            'name': 'Invoices',
            'res_model': 'account.move',
            'view_mode': 'list,form',
            'domain': [
                ('spa_appointment_id', '=', self.id),
                ('move_type', '=', 'out_invoice')
            ],
            'context': {
                'default_spa_appointment_id': self.id,
                'default_partner_id': self.partner_id.id,
            }
        }

    @api.depends('start_datetime', 'duration')
    def _compute_end_datetime(self):
        for rec in self:
            if rec.start_datetime and rec.duration:
                rec.end_datetime = rec.start_datetime + timedelta(minutes=rec.duration)
            else:
                rec.end_datetime = rec.start_datetime

    def action_create_invoice(self):
        self.ensure_one()

        if not self.partner_id:
            raise UserError("Please select a customer.")

        invoice_lines = []

        spa_product = self.env['product.product'].search(
            [('name', '=', 'Spa Service')], limit=1
        )

        membership = self.membership_id
        package = self.package_id

        if membership and membership.state != 'active':
            raise UserError("Selected membership is not active.")

        package_added = False

        # -------------------------------------------------
        # 1️⃣ SERVICE LINES
        # -------------------------------------------------
        for line in self.service_line_ids:

            price = line.service_charge
            discount = 0.0
            covered_by_package = False

            if package:
                package_service = package.line_ids.filtered(
                    lambda s: s.service_id.id == line.service_id.id
                )
                if package_service:
                    covered_by_package = True
                    package_added = True

            if covered_by_package:
                price = 0.0
            else:
                # Not in package — charge normally, apply membership discount if any
                if membership:
                    member_service = membership.service_line_ids.filtered(
                        lambda s: s.service_id.id == line.service_id.id
                    )
                    if member_service:
                        member_service = member_service[0]
                        discount = member_service.discount_percentage

                        if member_service.allowed_sessions:
                            if member_service.used_sessions >= member_service.allowed_sessions:
                                raise UserError(
                                    f"Allowed sessions exceeded for {line.service_id.name}"
                                )
                            member_service.used_sessions += 1

            invoice_lines.append((0, 0, {
                'product_id': spa_product.id,
                'name': line.service_id.name,
                'quantity': 1,
                'price_unit': price,
                'discount': discount,
            }))

        # -------------------------------------------------
        # 2️⃣ CONSUMABLE PRODUCTS
        # -------------------------------------------------
        for line in self.consumable_line_ids:

            price = line.unit_price
            discount = 0.0
            covered_by_package = False

            if package:
                # Check each package service line's consumables
                pkg_consumable = package.line_ids.mapped('service_id.consumable_ids').filtered(
                    lambda p: p.product_id.id == line.product_id.id
                )
                if pkg_consumable:
                    covered_by_package = True
                    package_added = True

            if covered_by_package:
                price = 0.0
            else:
                # Not in package — charge normally, apply membership discount if any
                if membership:
                    member_product = membership.product_line_ids.filtered(
                        lambda p: p.product_id.id == line.product_id.id
                    )
                    if member_product:
                        discount = member_product[0].discount_percentage

            invoice_lines.append((0, 0, {
                'product_id': line.product_id.id,
                'name': line.product_id.display_name,
                'quantity': line.quantity,
                'price_unit': price,
                'discount': discount,
            }))

        # -------------------------------------------------
        # 3️⃣ ADD PACKAGE LINE (ONLY ONCE)
        # -------------------------------------------------
        if package and package_added:
            package_product = self.env['product.product'].search(
                [('name', '=', 'Package')], limit=1
            )
            if not package_product:
                raise UserError("Product 'Package' not found. Please create it first.")

            invoice_lines.append((0, 0, {
                'product_id': package_product.id,
                'name': package.name,
                'quantity': 1,
                'price_unit': package.price,
            }))

        # -------------------------------------------------
        # 4️⃣ CREATE INVOICE
        # -------------------------------------------------
        invoice = self.env['account.move'].create({
            'move_type': 'out_invoice',
            'partner_id': self.partner_id.id,
            'invoice_origin': self.name,
            'spa_appointment_id': self.id,
            'invoice_line_ids': invoice_lines,
        })

        self.invoice_id = invoice.id

        return {
            'type': 'ir.actions.act_window',
            'name': 'Customer Invoice',
            'res_model': 'account.move',
            'view_mode': 'form',
            'res_id': invoice.id,
            'target': 'current',
        }


    @api.depends('invoice_id', 'invoice_id.payment_state')
    def _compute_is_invoiced(self):
        for rec in self:
            rec.is_invoiced = bool(rec.invoice_id and rec.invoice_id.payment_state in ['paid', 'in_payment'])



    @api.onchange('service_line_ids', 'service_line_ids.service_id')
    def _onchange_service_lines(self):
        """
        Load consumables automatically from all selected services
        """

        consumable_lines = []

        # clear existing lines
        self.consumable_line_ids = [(5, 0, 0)]

        for service_line in self.service_line_ids:

            service = service_line.service_id
            if not service:
                continue

            # fetch consumables configured in service
            for consumable in service.consumable_ids:
                consumable_lines.append((0, 0, {
                    'product_id': consumable.product_id.id,
                    'quantity': consumable.quantity,
                    'uom_id': consumable.uom_id.id,
                    'unit_price': consumable.product_price,
                }))

        self.consumable_line_ids = consumable_lines

    def recompute_consumable_lines(self):
        print("=== recompute_consumable_lines CALLED ===")
        print(f"Appointments: {self.ids}")

        for appointment in self:
            print(f"Processing appointment ID: {appointment.id}")
            print(f"Service lines count: {len(appointment.service_line_ids)}")

            # Clear existing consumable lines
            appointment.consumable_line_ids.unlink()
            print("Existing consumable lines cleared")

            for service_line in appointment.service_line_ids:
                service = service_line.service_id
                print(f"  Service line: {service_line.id}, Service: {service.name if service else 'NONE'}")

                if not service:
                    print("  Skipping — no service found")
                    continue

                print(f"  Consumables count for this service: {len(service.consumable_ids)}")

                for product in service.consumable_ids:
                    print(f"    Creating consumable line — product: {product.product_id.name}, qty: {product.quantity}")
                    appointment.consumable_line_ids.create({
                        'appointment_id': appointment.id,
                        'product_id': product.product_id.id,
                        'quantity': product.quantity,
                        'unit_price': product.product_price,
                        'uom_id': product.uom_id.id,
                    })
                    print(f"    Consumable line created successfully")

        print("=== recompute_consumable_lines DONE ===")

    def action_confirm(self):
        for rec in self:

            print("\n========== CONFIRM APPOINTMENT START ==========")
            print("Appointment ID:", rec.id)
            print("Customer:", rec.partner_id.name if rec.partner_id else "N/A")

            # ── Therapist Check ─────────────────────────────
            print("Checking therapist assignment...")

            if not rec.therapist_id:
                print("❌ Therapist missing")
                raise UserError(_('Please assign a therapist before confirming.'))

            print("Therapist:", rec.therapist_id.name)

            # ── Room Check ──────────────────────────────────
            print("Checking room assignment...")

            if not rec.room_id:
                print("❌ Room missing")
                raise UserError(_('Please assign a room before confirming.'))

            print("Room:", rec.room_id.name)
            print("Room Status:", rec.room_id.status)

            print("Start Time:", rec.start_datetime)
            print("End Time:", rec.end_datetime)

            # ── Therapist Conflict Check ─────────────────────
            print("Checking therapist availability...")

            therapist_conflict = self.search([
                ('id', '!=', rec.id),
                ('therapist_id', '=', rec.therapist_id.id),
                ('state', 'in', ['confirmed', 'in_progress']),
                ('start_datetime', '<', rec.end_datetime),
                ('end_datetime', '>', rec.start_datetime),
            ], limit=1)

            print("Therapist conflict found:", therapist_conflict.id if therapist_conflict else "No")

            if therapist_conflict:
                print("❌ Therapist booking conflict detected")
                raise UserError(_(
                    'Therapist "%s" is already booked in another confirmed/in-progress appointment during this time slot.'
                ) % rec.therapist_id.name)

            # ── Room Maintenance Check ───────────────────────
            print("Checking room maintenance status...")

            if rec.room_id.status in ('maintenance', 'cleaning'):
                print("❌ Room unavailable due to:", rec.room_id.status)
                raise UserError(_(
                    'Room "%s" is currently under %s and cannot be booked.'
                ) % (rec.room_id.name, rec.room_id.status))

            # ── Room Conflict Check ──────────────────────────
            print("Checking room availability...")

            room_conflict = self.search([
                ('id', '!=', rec.id),
                ('room_id', '=', rec.room_id.id),
                ('state', 'in', ['confirmed', 'in_progress']),
                ('start_datetime', '<', rec.end_datetime),
                ('end_datetime', '>', rec.start_datetime),
            ], limit=1)

            print("Room conflict found:", room_conflict.id if room_conflict else "No")

            if room_conflict:
                print("❌ Room booking conflict detected")
                raise UserError(_(
                    'Room "%s" is already booked in another confirmed/in-progress appointment during this time slot.'
                ) % rec.room_id.name)

            # ── Confirm Appointment ──────────────────────────
            print("✅ No conflicts found. Confirming appointment...")

            rec.state = 'confirmed'

            rec.message_post(body=_(
                'Appointment confirmed. Therapist: %s | Room: %s | Time: %s → %s'
            ) % (
                                      rec.therapist_id.name,
                                      rec.room_id.name,
                                      rec.start_datetime.strftime('%d/%m/%Y %H:%M'),
                                      rec.end_datetime.strftime('%d/%m/%Y %H:%M') if rec.end_datetime else '—',
                                  ))

            print("✅ Appointment Confirmed Successfully")
            print("========== CONFIRM APPOINTMENT END ==========\n")


    @api.model
    def get_appointment_report(self, date_from=False, date_to=False):
        domain = []

        if date_from:
            domain.append(('start_datetime', '>=', date_from))

        if date_to:
            domain.append(('start_datetime', '<=', date_to))

        appointments = self.search(domain, order="start_datetime desc")

        result = []

        for rec in appointments:
            result.append({
                'appointment': rec.name,
                'customer': rec.partner_id.name,
                'date': rec.start_datetime.strftime('%Y-%m-%d %H:%M') if rec.start_datetime else '',
                'total_price': rec.total_price,
            })

        return result


    def action_start(self):
        self.state = 'in_progress'
        if self.room_id:
            self.room_id.status = 'occupied'

    def action_complete(self):
        for rec in self:
            rec.state = 'completed'
            if rec.room_id:
                rec.room_id.status = 'available'
            # Auto-deduct consumables
            rec._deduct_consumables()
            # Auto-create commission
            # rec._create_commission()
    #
    def action_cancel(self):
        for rec in self:
            if rec.state in ('completed',):
                raise UserError(_('Cannot cancel a completed appointment.'))
            rec.state = 'cancelled'
            if rec.room_id:
                rec.room_id.status = 'available'

    def action_no_show(self):
        self.state = 'no_show'
    # #
    def action_checkout(self):
        for rec in self:
            rec.state = 'completed'
            rec._create_therapist_commission()
            rec._create_consumable_delivery()


    def _create_consumable_delivery(self):
        StockPicking = self.env['stock.picking']
        StockMove = self.env['stock.move']

        for rec in self:

            if not rec.consumable_line_ids:
                return

            # -------------------------------------------------
            # Locations
            # -------------------------------------------------
            source_location = self.env.ref('stock.stock_location_stock')
            dest_location = self.env.ref('stock.stock_location_customers')

            # -------------------------------------------------
            # Picking Type (Delivery Orders)
            # -------------------------------------------------
            picking_type = self.env['stock.picking.type'].search(
                [('code', '=', 'outgoing'),
                 ('warehouse_id.company_id', '=', rec.company_id.id)],
                limit=1
            )

            # -------------------------------------------------
            # Create Picking
            # -------------------------------------------------
            picking = StockPicking.create({
                'partner_id': rec.partner_id.id,
                'picking_type_id': picking_type.id,
                'location_id': source_location.id,
                'location_dest_id': dest_location.id,
                'origin': rec.name,
                'spa_appointment_ids': rec.id,
            })

            # -------------------------------------------------
            # Create Stock Moves
            # -------------------------------------------------
            for line in rec.consumable_line_ids:
                if not line.product_id:
                    continue

                StockMove.create({
                    'name': line.product_id.display_name,
                    'product_id': line.product_id.id,
                    'product_uom_qty': line.quantity,
                    'product_uom': line.uom_id.id or line.product_id.uom_id.id,
                    'picking_id': picking.id,
                    'location_id': source_location.id,
                    'location_dest_id': dest_location.id,
                    'origin': rec.name,

                })

            # -------------------------------------------------
            # Confirm → Assign → Validate
            # -------------------------------------------------
            picking.action_confirm()
            picking.action_assign()

            # Set done quantity automatically
            for move in picking.move_ids:
                move.quantity = move.product_uom_qty

            picking.button_validate()

    def _create_therapist_commission(self):
        for rec in self:

            # Therapist required
            if not rec.therapist_id:
                continue

            therapist = rec.therapist_id

            # Remove old commissions (avoid duplicates)
            rec.commission_ids.unlink()

            # -------------------------------------------------
            # LOOP THROUGH SERVICES
            # -------------------------------------------------
            for line in rec.service_line_ids:

                service = line.service_id

                if not service:
                    continue

                # Therapist must have skill
                if service not in therapist.skill_ids:
                    continue

                # Commission enabled?
                if not service.is_commission:
                    continue

                service_amount = line.service_charge or 0.0
                commission_amount = 0.0

                # -------------------------
                # CALCULATION
                # -------------------------
                if service.commission_type == 'percentage':
                    commission_amount = (
                                                service_amount * service.commission_value
                                        ) / 100

                elif service.commission_type == 'fixed':
                    commission_amount = service.commission_value

                # -------------------------
                # CREATE COMMISSION RECORD
                # -------------------------
                self.env['spa.therapist.commission'].create({
                    'appointment_id': rec.id,
                    'therapist_id': therapist.id,
                    'service_id': service.id,
                    'service_amount': service_amount,
                    'commission_type': service.commission_type,
                    'commission_value': service.commission_value,
                    'commission_amount': commission_amount,
                })

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('spa.appointment') or 'New'
        return super().create(vals_list)



class SpaAppointmentConsumable(models.Model):
    _name = 'spa.appointment.consumable'
    _description = 'Appointment Consumables'

    appointment_id = fields.Many2one(
        'spa.appointment',
        ondelete='cascade'
    )

    product_id = fields.Many2one(
        'product.product',
        string='Product',
        required=True
    )

    quantity = fields.Float('Quantity', default=1.0)
    uom_id = fields.Many2one('uom.uom', string='UOM')

    currency_id = fields.Many2one(
        'res.currency',
        default=lambda self: self.env.company.currency_id
    )

    unit_price = fields.Monetary(
        string="Unit Price",
        currency_field="currency_id"
    )

    total_amount = fields.Monetary(
        string="Total",
        currency_field="currency_id",
        compute="_compute_total",
        store=True
    )

    @api.depends('quantity', 'unit_price')
    def _compute_total(self):
        for rec in self:
            rec.total_amount = rec.quantity * rec.unit_price


class SpaAppointmentService(models.Model):
    _name = 'spa.appointment.service'
    _description = 'Appointment Services'

    appointment_id = fields.Many2one(
        'spa.appointment',
        ondelete='cascade'
    )

    service_id = fields.Many2one(
        'spa.service',
        string="Service",
        required=True
    )

    currency_id = fields.Many2one(
        'res.currency',
        default=lambda self: self.env.company.currency_id
    )

    service_charge = fields.Monetary(
        string="Service Charge",
        currency_field="currency_id"
    )

    # In spa.appointment.line (or whatever your line model is called)
    @api.onchange('service_id')
    def _onchange_service_id(self):
        if self.service_id:
            self.service_charge = self.service_id.service_charge

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('service_id') and not vals.get('service_charge'):
                service = self.env['spa.service'].browse(vals['service_id'])
                vals['service_charge'] = service.service_charge

        return super().create(vals_list)


