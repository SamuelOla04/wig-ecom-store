const express = require('express');
const cors = require('cors');
const stripe = require('stripe');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Stripe with your secret key
if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY is missing!');
    process.exit(1);
}
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

// Initialize email transporter
let emailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    console.log('📧 Email transporter initialized');
} else {
    console.warn('⚠️ Email configuration incomplete - emails will not work');
}

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:8080'],
    credentials: true
}));

// Raw body parser for Stripe webhooks
app.use('/webhook', express.raw({ type: 'application/json' }));

// JSON parser for other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the parent directory (your frontend)
app.use(express.static(path.join(__dirname, '..')));

// Product data (in a real app, this would come from a database)
const products = {
    "1": {
        id: "1",
        name: "The 'Malibu' Blonde Wig",
        price: 54999, // Price in cents for Stripe
        priceDisplay: "$549.99",
        image: "product1.jpg",
        description: "Stunning blonde wig with natural texture"
    },
    "2": {
        id: "2",
        name: "The 'Espresso' Brown Wig",
        price: 49999,
        priceDisplay: "$499.99",
        image: "product2.jpg",
        description: "Rich brown wig with luxurious feel"
    },
    "3": {
        id: "3",
        name: "The 'Autumn' Ginger Wig",
        price: 52999,
        priceDisplay: "$529.99",
        image: "product3.jpg",
        description: "Vibrant ginger wig for a bold look"
    },
    "4": {
        id: "4",
        name: "The 'Onyx' Black Wig",
        price: 49999,
        priceDisplay: "$499.99",
        image: "product4.jpg",
        description: "Classic black wig with elegant styling"
    }
};

// Routes

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Get all products
app.get('/api/products', (req, res) => {
    res.json(products);
});

// Get specific product
app.get('/api/products/:id', (req, res) => {
    const product = products[req.params.id];
    if (product) {
        res.json(product);
    } else {
        res.status(404).json({ error: 'Product not found' });
    }
});

// Create Stripe Checkout Session
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { items, customerInfo } = req.body;

        // Validate items exist in our product catalog
        const lineItems = items.map(item => {
            const product = products[item.id];
            if (!product) {
                throw new Error(`Product ${item.id} not found`);
            }
            
            return {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: product.name,
                        images: [`${req.protocol}://${req.get('host')}/${product.image}`],
                        description: product.description,
                    },
                    unit_amount: product.price, // Price in cents
                },
                quantity: item.quantity,
            };
        });

        // Create Stripe checkout session
        const session = await stripeClient.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            customer_email: customerInfo.email,
            shipping_address_collection: {
                allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add countries as needed
            },
            billing_address_collection: 'required',
            success_url: `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get('host')}/cancel`,
            metadata: {
                customer_name: customerInfo.name,
                customer_email: customerInfo.email,
                customer_address: customerInfo.address,
            },
        });

        res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ 
            error: 'Failed to create checkout session',
            message: error.message 
        });
    }
});

// Create Payment Intent for custom checkout
app.post('/api/create-payment-intent', async (req, res) => {
    try {
        const { items, customerInfo } = req.body;

        // Calculate total amount
        let totalAmount = 0;
        items.forEach(item => {
            const product = products[item.id];
            if (product) {
                totalAmount += product.price * item.quantity;
            }
        });

        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripeClient.paymentIntents.create({
            amount: totalAmount,
            currency: 'usd',
            metadata: {
                customer_name: customerInfo.name,
                customer_email: customerInfo.email,
                customer_address: customerInfo.address,
                items: JSON.stringify(items)
            },
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            amount: totalAmount
        });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ 
            error: 'Failed to create payment intent',
            message: error.message 
        });
    }
});

// Stripe webhook endpoint
app.post('/webhook', (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripeClient.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log('Payment successful for session:', session.id);
            
            // Here you would typically:
            // 1. Save order to database
            // 2. Send confirmation email
            // 3. Update inventory
            // 4. Fulfill the order
            
            handleSuccessfulPayment(session);
            break;

        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            console.log('Payment succeeded:', paymentIntent.id);
            handleSuccessfulPayment(paymentIntent);
            break;

        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            console.log('Payment failed:', failedPayment.id);
            // Handle failed payment
            break;

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});

// Success page
app.get('/success', async (req, res) => {
    const sessionId = req.query.session_id;
    
    if (sessionId) {
        try {
            const session = await stripeClient.checkout.sessions.retrieve(sessionId);
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Payment Success - LUXE WIGS</title>
                    <link rel="stylesheet" href="style.css">
                </head>
                <body>
                    <div class="container" style="text-align: center; padding: 50px;">
                        <h1>Payment Successful!</h1>
                        <p>Thank you for your purchase. Your order has been confirmed.</p>
                        <p>Session ID: ${session.id}</p>
                        <p>Amount: $${(session.amount_total / 100).toFixed(2)}</p>
                        <a href="/" class="cta-button">Continue Shopping</a>
                    </div>
                </body>
                </html>
            `);
        } catch (error) {
            res.send('Error retrieving session information');
        }
    } else {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Payment Success - LUXE WIGS</title>
                <link rel="stylesheet" href="style.css">
            </head>
            <body>
                <div class="container" style="text-align: center; padding: 50px;">
                    <h1>Payment Successful!</h1>
                    <p>Thank you for your purchase!</p>
                    <a href="/" class="cta-button">Continue Shopping</a>
                </div>
            </body>
            </html>
        `);
    }
});

// Cancel page
app.get('/cancel', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Payment Cancelled - LUXE WIGS</title>
            <link rel="stylesheet" href="style.css">
        </head>
        <body>
            <div class="container" style="text-align: center; padding: 50px;">
                <h1>Payment Cancelled</h1>
                <p>Your payment was cancelled. No charges have been made.</p>
                <a href="/" class="cta-button">Return to Shop</a>
            </div>
        </body>
        </html>
    `);
});

// Email template function
function createOrderConfirmationEmail(orderDetails) {
    const { customerName, customerEmail, orderItems, totalAmount, orderId } = orderDetails;
    
    const itemsList = orderItems.map(item => 
        `• ${item.name} (Qty: ${item.quantity}) - $${(item.price * item.quantity / 100).toFixed(2)}`
    ).join('\n');
    
    return {
        subject: `Order Confirmation - LUXE WIGS #${orderId}`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #000; color: white; padding: 20px; text-align: center; }
                    .content { padding: 20px; background: #f9f9f9; }
                    .order-details { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
                    .footer { text-align: center; padding: 20px; color: #666; }
                    .shipping-info { background: #e8f4f8; padding: 15px; border-left: 4px solid #2196F3; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>LUXE WIGS</h1>
                        <p>Thank you for your order!</p>
                    </div>
                    
                    <div class="content">
                        <h2>Hi ${customerName},</h2>
                        <p>Your order has been confirmed and we're getting it ready for you!</p>
                        
                        <div class="order-details">
                            <h3>Order #${orderId}</h3>
                            <p><strong>Items ordered:</strong></p>
                            ${orderItems.map(item => `
                                <p>• ${item.name} (Qty: ${item.quantity}) - $${(item.price * item.quantity / 100).toFixed(2)}</p>
                            `).join('')}
                            <hr>
                            <p><strong>Total: $${(totalAmount / 100).toFixed(2)}</strong></p>
                        </div>
                        
                        <div class="shipping-info">
                            <h3>📦 Shipping Information</h3>
                            <p><strong>Estimated Delivery:</strong> 7-14 business days</p>
                            <p>Your premium wig will be carefully packaged and shipped to the address provided during checkout.</p>
                            <p>You will receive a tracking number once your order ships.</p>
                        </div>
                        
                        <p>If you have any questions about your order, please don't hesitate to contact us.</p>
                    </div>
                    
                    <div class="footer">
                        <p>Thank you for choosing LUXE WIGS!</p>
                        <p>📧 contact@luxewigs.com | 📞 +1 (234) 567-890</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
Hi ${customerName},

Thank you for your order with LUXE WIGS!

Order #${orderId}
Items ordered:
${itemsList}

Total: $${(totalAmount / 100).toFixed(2)}

SHIPPING INFORMATION:
Estimated Delivery: 7-14 business days
Your premium wig will be carefully packaged and shipped to the address provided during checkout.
You will receive a tracking number once your order ships.

If you have any questions about your order, please contact us at contact@luxewigs.com

Thank you for choosing LUXE WIGS!
        `
    };
}

// Function to send order confirmation email
async function sendOrderConfirmationEmail(orderDetails) {
    try {
        if (!emailTransporter) {
            console.warn('⚠️ Email not configured - skipping email notification');
            return { success: false, error: 'Email not configured' };
        }

        const emailContent = createOrderConfirmationEmail(orderDetails);
        
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'LUXE WIGS <noreply@example.com>',
            to: orderDetails.customerEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log('✅ Order confirmation email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('❌ Failed to send order confirmation email:', error);
        return { success: false, error: error.message };
    }
}

// Helper function to handle successful payments
async function handleSuccessfulPayment(paymentData) {
    console.log('Processing successful payment:', paymentData);
    
    try {
        // Extract order details
        const orderId = paymentData.id;
        const totalAmount = paymentData.amount_total || paymentData.amount;
        const customerEmail = paymentData.customer_email || paymentData.metadata?.customer_email;
        const customerName = paymentData.metadata?.customer_name || 'Valued Customer';
        
        // Parse items from metadata (if available)
        let orderItems = [];
        if (paymentData.metadata?.items) {
            try {
                orderItems = JSON.parse(paymentData.metadata.items);
            } catch (e) {
                console.error('Error parsing order items:', e);
            }
        }
        
        // If no items in metadata, create a generic entry
        if (orderItems.length === 0) {
            orderItems = [{
                name: 'Premium Wig Order',
                quantity: 1,
                price: totalAmount
            }];
        }
        
        // Send confirmation email
        const emailResult = await sendOrderConfirmationEmail({
            customerName,
            customerEmail,
            orderItems,
            totalAmount,
            orderId
        });
        
        console.log('Order details:', {
            id: orderId,
            amount: totalAmount,
            customer: customerEmail,
            emailSent: emailResult.success
        });
        
    } catch (error) {
        console.error('Error processing successful payment:', error);
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving static files from: ${path.join(__dirname, '..')}`);
    console.log(`💳 Stripe integration ready`);
    
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
        console.warn('⚠️  STRIPE_WEBHOOK_SECRET not found in environment variables');
    }
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.warn('⚠️  EMAIL configuration incomplete - order confirmation emails will not work');
        console.warn('   Add EMAIL_USER and EMAIL_PASS to your .env file');
    } else { 
        console.log('📧 Email notifications ready');
    }
});

module.exports = app;


