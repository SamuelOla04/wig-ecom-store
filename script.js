document.addEventListener('DOMContentLoaded', () => {

    // --- ELEMENT SELECTORS ---
    const addToCartButtons = document.querySelectorAll('.add-to-cart-btn');
    const cartNotification = document.getElementById('cart-notification');

    // Cart Modal Elements
    const cartModal = document.getElementById('cart-modal');
    const cartIcon = document.querySelector('.cart-icon-link');
    const cartLink = document.querySelector('.cart-link');
    const closeCartBtn = document.getElementById('cart-close-btn');
    const cartItemsContainer = document.getElementById('cart-items-container');
    const cartSubtotalElem = document.getElementById('cart-subtotal');
    const cartItemCountElem = document.getElementById('cart-item-count');

    // Checkout Modal Elements
    const checkoutModal = document.getElementById('checkout-modal');
    const openCheckoutBtn = document.querySelector('.checkout-btn'); // The button in the cart
    const closeCheckoutBtn = document.getElementById('checkout-close-btn');
    const checkoutForm = document.getElementById('checkout-form');

    // --- CART DATA ---
    let cart = JSON.parse(localStorage.getItem('shoppingCart')) || [];

    // --- FUNCTIONS ---
    const saveCart = () => {
        localStorage.setItem('shoppingCart', JSON.stringify(cart));
    };

    const showNotification = () => {
        cartNotification.classList.add('show');
        setTimeout(() => {
            cartNotification.classList.remove('show');
        }, 2000);
    };

    // Cart Modal Functions
    const openCart = () => cartModal.classList.add('active');
    const closeCart = () => cartModal.classList.remove('active');

    // NEW: Checkout Modal Functions
    const openCheckout = () => checkoutModal.classList.add('active');
    const closeCheckout = () => checkoutModal.classList.remove('active');

    const addItemToCart = (id, name, price, image) => {
        const existingItem = cart.find(item => item.id === id);
        if (existingItem) {
            existingItem.quantity++;
        } else {
            cart.push({ id, name, price: parseFloat(price.replace('$', '')), image, quantity: 1 });
        }
        updateCartDisplay();
    };
    
    const updateCartDisplay = () => {
        cartItemsContainer.innerHTML = '';
        let subtotal = 0;
        let totalItems = 0;

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart-message">Your cart is currently empty.</p>';
        } else {
            cart.forEach(item => {
                const itemTotalPrice = item.price * item.quantity;
                const cartItemHTML = `
                    <div class="cart-item" data-id="${item.id}">
                        <img src="${item.image}" alt="${item.name}" class="cart-item-image">
                        <div class="cart-item-details">
                            <div class="cart-item-header">
                                <span class="cart-item-name">${item.name}</span>
                                <span class="cart-item-total-price">$${itemTotalPrice.toFixed(2)}</span>
                            </div>
                            <p class="cart-item-unit-price">$${item.price.toFixed(2)} each</p>
                            <div class="cart-item-actions">
                                <div class="quantity-control">
                                    <button class="quantity-btn decrease-qty">-</button>
                                    <span class="quantity-display">${item.quantity}</span>
                                    <button class="quantity-btn increase-qty">+</button>
                                </div>
                                <button class="delete-item-btn">&times;</button>
                            </div>
                        </div>
                    </div>
                `;
                cartItemsContainer.insertAdjacentHTML('beforeend', cartItemHTML);
                subtotal += itemTotalPrice;
                totalItems += item.quantity;
            });
        }
        
        cartSubtotalElem.innerText = `$${subtotal.toFixed(2)}`;
        cartItemCountElem.innerText = `${totalItems} ${totalItems === 1 ? 'item' : 'items'} in cart`;
        
        saveCart();
    };

    const handleCartClick = (e) => {
        const target = e.target;
        const parentCartItem = target.closest('.cart-item');
        if (!parentCartItem) return;
        const productId = parentCartItem.dataset.id;
        if (target.matches('.increase-qty')) changeQuantity(productId, 1);
        if (target.matches('.decrease-qty')) changeQuantity(productId, -1);
        if (target.matches('.delete-item-btn')) removeItemFromCart(productId);
    };

    const changeQuantity = (id, amount) => {
        const item = cart.find(item => item.id === id);
        if (item) {
            item.quantity += amount;
            if (item.quantity <= 0) removeItemFromCart(id);
            else updateCartDisplay();
        }
    };
    
    const removeItemFromCart = (id) => {
        cart = cart.filter(item => item.id !== id);
        updateCartDisplay();
    };
    
    // --- EVENT LISTENERS ---
    cartIcon.addEventListener('click', (e) => {
        e.preventDefault();
        openCart();
    });

    // View Cart link in shop section
    cartLink.addEventListener('click', (e) => {
        e.preventDefault();
        openCart();
    });

    closeCartBtn.addEventListener('click', closeCart);
    cartModal.addEventListener('click', (e) => {
        if (e.target === cartModal) closeCart();
    });

    addToCartButtons.forEach(button => {
        button.addEventListener('click', () => {
            const productItem = button.closest('.product-item');
            const productId = productItem.dataset.id;
            const productName = productItem.querySelector('.product-name').innerText;
            const productPrice = productItem.querySelector('.product-price').innerText;
            const productImage = productItem.querySelector('.product-image').src;
            addItemToCart(productId, productName, productPrice, productImage);
            showNotification();
        });
    });

    cartItemsContainer.addEventListener('click', handleCartClick);

    // NEW: Checkout Modal Event Listeners
    openCheckoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (cart.length > 0) {
            closeCart();
            openCheckout();
        } else {
            alert("Your cart is empty.");
        }
    });

    closeCheckoutBtn.addEventListener('click', closeCheckout);
    checkoutModal.addEventListener('click', (e) => {
        if (e.target === checkoutModal) closeCheckout();
    });

    checkoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (cart.length === 0) {
            alert('Your cart is empty!');
            return;
        }

        // Get form data
        const formData = new FormData(checkoutForm);
        const customerInfo = {
            name: formData.get('name'),
            email: formData.get('email'),
            address: formData.get('address')
        };

        // Prepare cart items for backend
        const items = cart.map(item => ({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity
        }));

        try {
            // Show loading state
            const payButton = checkoutForm.querySelector('.pay-btn');
            const originalText = payButton.textContent;
            payButton.textContent = 'Processing...';
            payButton.disabled = true;

            // Create checkout session with Stripe
            const response = await fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    items: items,
                    customerInfo: customerInfo
                })
            });

            const data = await response.json();

            if (response.ok && data.url) {
                // Redirect to Stripe Checkout
                window.location.href = data.url;
            } else {
                throw new Error(data.message || 'Failed to create checkout session');
            }

        } catch (error) {
            console.error('Checkout error:', error);
            alert('Payment processing failed. Please try again.');
            
            // Reset button state
            const payButton = checkoutForm.querySelector('.pay-btn');
            payButton.textContent = 'Pay';
            payButton.disabled = false;
        }
    });

    // --- INITIALIZATION ---
    updateCartDisplay();
});