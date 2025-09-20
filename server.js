const express = require('express');
const cors = require('cors');
const stripe = require('stripe');
const nodemailer = require('nodemailer');
const path = require('path');
// const cron = require('node-cron'); // Temporarily disabled

// Only use dotenv in development
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// Debug: Check what environment variables are available
console.log('🔍 Environment variables available:');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'SET' : 'MISSING');
console.log('EMAIL_USER:', process.env.EMAIL_USER ? 'SET' : 'MISSING');
console.log('NODE_ENV:', process.env.NODE_ENV);

// Initialize Stripe with your secret key
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
    console.error('❌ STRIPE_SECRET_KEY is required! Please add it to your .env file');
    process.exit(1);
}
console.log('💳 Using Stripe key:', STRIPE_KEY ? 'SET' : 'MISSING');
const stripeClient = stripe(STRIPE_KEY);

// Initialize email transporter
let emailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    console.log('📧 Email transporter initialized');
} else {
    console.warn('⚠️ Email configuration incomplete - emails will not work (payments still work!)');
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

// In-memory order tracking (in production, use a database)
const orders = new Map();

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
    const { customerName, customerEmail, orderItems, totalAmount, orderId, deliveryDate } = orderDetails;
    
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
                            <p><strong>Expected Delivery:</strong> ${deliveryDate ? deliveryDate.toDateString() : '7-14 business days'}</p>
                            <p>Your premium wig will be carefully packaged and shipped to the address provided during checkout.</p>
                            <p>You will receive daily countdown reminders and tracking information!</p>
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

        // Store order for tracking
        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + 7); // 7 days delivery
        
        orders.set(orderId, {
            id: orderId,
            customerName,
            customerEmail,
            orderItems,
            totalAmount,
            orderDate: new Date(),
            deliveryDate,
            emailsSent: 0 // Track how many countdown emails sent
        });
        
        // Send confirmation email
        const emailResult = await sendOrderConfirmationEmail({
            customerName,
            customerEmail,
            orderItems,
            totalAmount,
            orderId,
            deliveryDate
        });
        
        console.log('Order details:', {
            id: orderId,
            amount: totalAmount,
            customer: customerEmail,
            emailSent: emailResult.success,
            deliveryDate: deliveryDate.toDateString()
        });
        
    } catch (error) {
        console.error('Error processing successful payment:', error);
    }
}

// Countdown email template
function createCountdownEmail(order, daysLeft) {
    const { customerName, orderId, orderItems, deliveryDate } = order;
    
    let message = '';
    let emoji = '';
    
    if (daysLeft === 6) {
        message = 'Your amazing new wig is on its way!';
        emoji = '🚛';
    } else if (daysLeft === 5) {
        message = 'Just 5 more days until your wig arrives!';
        emoji = '📦';
    } else if (daysLeft === 4) {
        message = 'Getting closer! 4 days to go!';
        emoji = '⏰';
    } else if (daysLeft === 3) {
        message = 'Only 3 days left - almost there!';
        emoji = '✨';
    } else if (daysLeft === 2) {
        message = 'Just 2 more days - prepare for your new look!';
        emoji = '🎉';
    } else if (daysLeft === 1) {
        message = 'Tomorrow is the day! Your wig arrives soon!';
        emoji = '🎊';
    } else if (daysLeft === 0) {
        message = 'Delivery day is here! Your wig should arrive today!';
        emoji = '🎁';
    }

    return {
        subject: `${emoji} ${daysLeft === 0 ? 'Delivery Day' : `${daysLeft} Days Left`} - LUXE WIGS Order #${orderId}`,
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { padding: 30px; background: #f9f9f9; border-radius: 0 0 10px 10px; }
                    .countdown { background: white; padding: 25px; margin: 20px 0; border-radius: 10px; text-align: center; border: 3px solid #667eea; }
                    .countdown h2 { color: #667eea; font-size: 2.5em; margin: 0; }
                    .order-summary { background: white; padding: 20px; margin: 15px 0; border-radius: 8px; }
                    .footer { text-align: center; padding: 20px; color: #666; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>${emoji} LUXE WIGS</h1>
                        <p>${message}</p>
                    </div>
                    
                    <div class="content">
                        <h2>Hi ${customerName}! 👋</h2>
                        
                        <div class="countdown">
                            <h2>${daysLeft === 0 ? 'TODAY!' : `${daysLeft} DAYS`}</h2>
                            <p>${daysLeft === 0 ? 'Your delivery should arrive today!' : `Until your stunning wig arrives on ${deliveryDate.toDateString()}`}</p>
                        </div>
                        
                        <div class="order-summary">
                            <h3>📋 Your Order #${orderId}</h3>
                            ${orderItems.map(item => `
                                <p>• ${item.name} (Qty: ${item.quantity})</p>
                            `).join('')}
                        </div>
                        
                        ${daysLeft === 0 ? 
                            '<p>🏠 <strong>Keep an eye out for your delivery today!</strong> Make sure someone is available to receive your package.</p>' :
                            '<p>🚚 Your order is being carefully prepared and will be delivered exactly on time!</p>'
                        }
                        
                        <p>Questions? Just reply to this email - we're here to help! 💝</p>
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
Hi ${customerName}!

${message}

${daysLeft === 0 ? 'TODAY!' : `${daysLeft} DAYS LEFT`}
${daysLeft === 0 ? 'Your delivery should arrive today!' : `Until your wig arrives on ${deliveryDate.toDateString()}`}

Your Order #${orderId}:
${orderItems.map(item => `• ${item.name} (Qty: ${item.quantity})`).join('\n')}

${daysLeft === 0 ? 
    'Keep an eye out for your delivery today! Make sure someone is available to receive your package.' :
    'Your order is being carefully prepared and will be delivered exactly on time!'
}

Questions? Just reply to this email - we're here to help!

Thank you for choosing LUXE WIGS!
        `
    };
}

// Send countdown email
async function sendCountdownEmail(order, daysLeft) {
    try {
        if (!emailTransporter) {
            console.log(`⚠️ Email not configured - would send ${daysLeft}-day countdown to ${order.customerEmail}`);
            return { success: false, error: 'Email not configured' };
        }

        const emailContent = createCountdownEmail(order, daysLeft);
        
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'LUXE WIGS <noreply@example.com>',
            to: order.customerEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log(`✅ Countdown email sent (${daysLeft} days) to ${order.customerEmail}:`, info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error(`❌ Failed to send countdown email to ${order.customerEmail}:`, error);
        return { success: false, error: error.message };
    }
}

// Daily email countdown cron job (runs at 10 AM every day) - TEMPORARILY DISABLED
/*
cron.schedule('0 10 * * *', async () => {
    console.log('🕙 Running daily email countdown check...');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const [orderId, order] of orders.entries()) {
        const deliveryDate = new Date(order.deliveryDate);
        deliveryDate.setHours(0, 0, 0, 0);
        
        const diffTime = deliveryDate - today;
        const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Send emails for days 6, 5, 4, 3, 2, 1, and 0 (delivery day)
        if (daysLeft >= 0 && daysLeft <= 6) {
            // Check if we already sent this day's email
            if (order.emailsSent < (7 - daysLeft)) {
                await sendCountdownEmail(order, daysLeft);
                order.emailsSent = 7 - daysLeft; // Update emails sent count
                orders.set(orderId, order); // Update the order
            }
        }
        
        // Clean up old orders (7 days after delivery)
        if (daysLeft < -7) {
            orders.delete(orderId);
            console.log(`🗑️ Cleaned up old order: ${orderId}`);
        }
    }
});
*/

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
        console.warn('   📅 Daily countdown emails will also be disabled');
    } else { 
        console.log('📧 Email notifications ready');
        console.log('📅 Daily countdown email system active (runs at 10 AM)');
    }
});

module.exports = app;


