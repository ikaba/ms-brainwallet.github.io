(function($){

    var gen_from = 'pass';
    var gen_compressed = false;
    var gen_eckey = null;
    var gen_pt = null;
    var gen_ps_reset = false;
    var gen_timeout = 600;
    var timeout = null;

    function parseBase58Check(address) {
        var bytes = Bitcoin.Base58.decode(address);
        var end = bytes.length - 4;
        var hash = bytes.slice(0, end);
        var checksum = Crypto.SHA256(Crypto.SHA256(hash, {asBytes: true}), {asBytes: true});
        if (checksum[0] != bytes[end] ||
            checksum[1] != bytes[end+1] ||
            checksum[2] != bytes[end+2] ||
            checksum[3] != bytes[end+3])
                throw new Error("Wrong checksum");
        var version = hash.shift();
        return [version, hash];
    }

    encode_length = function(len) {
        if (len < 0x80)
            return [len];
        else if (len < 255)
            return [0x80|1, len];
        else
            return [0x80|2, len >> 8, len & 0xff];
    }
    
    encode_id = function(id, s) {
        var len = encode_length(s.length);
        return [id].concat(len).concat(s);
    }

    encode_integer = function(s) {
        if (typeof s == 'number')
            s = [s];
        return encode_id(0x02, s);
    }

    encode_octet_string = function(s)  {
        return encode_id(0x04, s);
    }

    encode_constructed = function(tag, s) {
        return encode_id(0xa0 + tag, s);
    }

    encode_bitstring = function(s) {
        return encode_id(0x03, s);
    }

    encode_sequence = function() {
        sequence = [];
        for (var i = 0; i < arguments.length; i++)
            sequence = sequence.concat(arguments[i]);
        return encode_id(0x30, sequence);
    }

    function getEncoded(pt, compressed) {
       var x = pt.getX().toBigInteger();
       var y = pt.getY().toBigInteger();
       var enc = integerToBytes(x, 32);
       if (compressed) {
         if (y.isEven()) {
           enc.unshift(0x02);
         } else {
           enc.unshift(0x03);
         }
       } else {
         enc.unshift(0x04);
         enc = enc.concat(integerToBytes(y, 32));
       }
       return enc;
    }

    function getDER(eckey, compressed) {
        var curve = getSECCurveByName("secp256k1");
        var _p = curve.getCurve().getQ().toByteArrayUnsigned();
        var _r = curve.getN().toByteArrayUnsigned();
        var encoded_oid = [0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x01, 0x01];

        var secret = integerToBytes(eckey.priv, 32);
        var encoded_gxgy = getEncoded(curve.getG(), compressed);
        var encoded_pub = getEncoded(gen_pt, compressed);

        return encode_sequence(
            encode_integer(1),
            encode_octet_string(secret),
            encode_constructed(0,
                encode_sequence(
                    encode_integer(1),
                    encode_sequence(
                        encoded_oid, //encode_oid(*(1, 2, 840, 10045, 1, 1)), //TODO
                        encode_integer([0].concat(_p))
                    ),
                    encode_sequence(
                        encode_octet_string([0]),
                        encode_octet_string([7])
                    ),
                    encode_octet_string(encoded_gxgy),
                    encode_integer([0].concat(_r)),
                    encode_integer(1)
                )
            ),
            encode_constructed(1, 
                encode_bitstring([0].concat(encoded_pub))
            )
        );
    }

    function pad(str, len, ch) {
        padding = '';
        for (var i = 0; i < len - str.length; i++) {
            padding += ch;
        }
        return padding + str;
    }

    function setErrorState(field, err, msg) {
        group = field.closest('.control-group');

        if (err) {
            group.addClass('error');
        } else {
            group.removeClass('error');
        }

        var e = group.find('.errormsg');
        if (e) {
            e.text(msg||'');
        }
    }

    function gen_random() {
        $('#pass').val('');
        $('#hash').focus();
        gen_from = 'hash';
        $('#secret').button('toggle');
        update_gen();
        var bytes = Crypto.util.randomBytes(32);
        $('#hash').val(Crypto.util.bytesToHex(bytes));
        generate();
    }

    function update_gen() {
        setErrorState($('#hash'), false);
        setErrorState($('#sec'), false);
        $('#pass').attr('readonly', gen_from != 'pass');
        $('#hash').attr('readonly', gen_from != 'hash');
        $('#sec').attr('readonly', gen_from != 'sec');
        $('#sec').parent().parent().removeClass('error');
    }

    function update_gen_from() {
        gen_from = $(this).attr('id').substring(5);
        update_gen();
        if (gen_from == 'pass') {
            if (gen_ps_reset) {
                gen_ps_reset = false;
                onChangePass();
            }
            $('#pass').focus();
        } else if (gen_from == 'hash') {
            $('#hash').focus();
        } else if (gen_from == 'sec') {
            $('#sec').focus();
        }
    }

    function update_gen_from_focus() {
        gen_from = $(this).attr('id');
        update_gen();
        if (gen_from == 'pass') {
            if (gen_ps_reset) {
                gen_ps_reset = false;
                onChangePass();
            }
        }
        $('#from_'+gen_from).button('toggle');
    }

    function generate() {

        var hash_str = pad($('#hash').val(), 64, '0');
        var hash = Crypto.util.hexToBytes(hash_str);

        eckey = new Bitcoin.ECKey(hash);

        gen_eckey = eckey;

        try {
            var curve = getSECCurveByName("secp256k1");
            gen_pt = curve.getG().multiply(eckey.priv);
            gen_eckey.pub = getEncoded(gen_pt, gen_compressed);
            gen_eckey.pubKeyHash = Bitcoin.Util.sha256ripe160(gen_eckey.pub);
            var addr = eckey.getBitcoinAddress();
            setErrorState($('#hash'), false);
        } catch (err) {
            console.info(err);
            setErrorState($('#hash'), true, 'Invalid secret exponent (must be non-zero value)');
            return;
        }

        gen_update();
    }

    function update_gen_compressed() {
        setErrorState($('#hash'), false);
        setErrorState($('#sec'), false);
        gen_compressed = $(this).attr('id') == 'compressed';
        gen_eckey.pub = getEncoded(gen_pt, gen_compressed);
        gen_eckey.pubKeyHash = Bitcoin.Util.sha256ripe160(gen_eckey.pub);
        gen_update();
    }

    function gen_update() {

        var eckey = gen_eckey;
        var compressed = gen_compressed;

        var hash_str = pad($('#hash').val(), 64, '0');
        var hash = Crypto.util.hexToBytes(hash_str);

        var hash160 = eckey.getPubKeyHash();

        var addr = eckey.getBitcoinAddress();
        $('#addr').val(addr);

        var h160 = Crypto.util.bytesToHex(hash160);
        $('#h160').val(h160);

        var payload = hash;

        if (compressed)
            payload.push(0x01);

        var sec = new Bitcoin.Address(payload); sec.version = 128;
        $('#sec').val(sec);

        var pub = Crypto.util.bytesToHex(getEncoded(gen_pt, compressed));
        $('#pub').val(pub);

        var der = Crypto.util.bytesToHex(getDER(eckey, compressed));
        $('#der').val(der);

        var img = '<img src="http://chart.apis.google.com/chart?cht=qr&chs=255x250&chl='+addr+'">';

        if (true) {
            var qr = qrcode(3, 'M');
            var text = $('#addr').val();
            text = text.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
            qr.addData(text);
            qr.make();
            img = qr.createImgTag(5);
        }

        var url = 'http://blockchain.info/address/'+addr;
        $('#qr').html('<a href="'+url+'" title="'+addr+'" target="_blank">'+img+'</a>');
        $('#qr_addr').text($('#addr').val());
    }


    function calc_hash() {
        var hash = Crypto.SHA256($('#pass').val(), { asBytes: true });
        $('#hash').val(Crypto.util.bytesToHex(hash));
    }

    function onChangePass() {
        calc_hash();
        clearTimeout(timeout);
        timeout = setTimeout(generate, gen_timeout);
    }

    function onChangeHash() {
        $('#pass').val('');
        gen_ps_reset = true;

        clearTimeout(timeout);

        if (/[^0123456789abcdef]+/i.test($('#hash').val())) {
            setErrorState($('#hash'), true, 'Erroneous characters (must be 0..9-a..f)');
            return;
        } else {
            setErrorState($('#hash'), false);
        }

        timeout = setTimeout(generate, gen_timeout);
    }

    function onChangePrivKey() {

        clearTimeout(timeout);

        $('#pass').val('');
        gen_ps_reset = true;

        var sec = $('#sec').val();

        try { 
            var res = parseBase58Check(sec); 
            var version = res[0];
            var payload = res[1];
        } catch (err) {
            setErrorState($('#sec'), true, 'Invalid private key checksum');
            return;
        };

        if (version != 128) {
            setErrorState($('#sec'), true, 'Invalid private key version (must be 128)');
            return;
        } else if (payload.length < 32) {
            setErrorState($('#sec'), true, 'Invalid payload (must be 32 or 33 bytes)');
            return;
        }

        setErrorState($('#sec'), false);

        if (payload.length > 32) {
            payload.pop();
            gen_compressed = true;
            $('#compressed').button('toggle');
        } else {
            gen_compressed = false;
            $('#uncompressed').button('toggle');
        }

        $('#hash').val(Crypto.util.bytesToHex(payload));

        timeout = setTimeout(generate, gen_timeout);
    }

    var from = 'hex';
    var to = 'hex';

    function update_enc_from() {
        from = $(this).attr('id').substring(5);
        translate();
    }

    function update_enc_to() {
        to = $(this).attr('id').substring(3);
        translate();
    }

    function strToBytes(str) {
        var bytes = [];
        for (var i = 0; i < str.length; ++i)
           bytes.push(str.charCodeAt(i));
        return bytes;
    }

    function bytesToString(bytes) {
        var str = '';
        for (var i = 0; i < bytes.length; ++i)
            str += String.fromCharCode(bytes[i]);
        return str;
    }

    function isHex(str) {
        return !/[^0123456789abcdef:, ]+/i.test(str);
    }

    function isBase58(str) {
        return !/[^123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+/.test(str);
    }

    function isBase64(str) {
        return !/[^ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=]+/.test(str) && (str.length % 4) == 0;
    }

    function issubset(a, ssv) {
        var b = ssv.trim().split(' ');
        for (var i = 0; i < b.length; i++) {
            if (a.indexOf(b[i].toLowerCase()) == -1 
                && a.indexOf(b[i].toUpperCase()) == -1)
            return false;
        }
        return true;
    }

    function autodetect(str) {
        var enc = [];
        if (isHex(str)) 
            enc.push('hex');
        if (isBase58(str))
            enc.push('base58');
        if (issubset(mn_words, str)) 
            enc.push('mnemonic');
        if (issubset(rfc1751_wordlist, str)) 
            enc.push('rfc1751');
        if (isBase64(str))
            enc.push('base64');
        if (str.length > 0)
            enc.push('text');
        return enc;
    }

    function update_toolbar(enc) {
        var reselect = false;
        $.each($('#enc_from').children(), function() {
            var id = $(this).attr('id').substring(5);
            var disabled = (enc && enc.indexOf(id) == -1);
            if (disabled && $(this).hasClass('active')) {
                $(this).removeClass('active');
                reselect = true;
            }
            $(this).attr('disabled', disabled);
        });
        if (enc && enc.length > 0 && reselect) {
            $('#from_' + enc[0]).addClass('active');
            from = enc[0];
        }
    }

    function enct(id) {
        return $('#from_'+id).text();
    }

    function translate() {

        var str = $('#src').val();

        if (str.length == 0) {
            update_toolbar(null);
            return;
        }

        text = str;

        var enc = autodetect(str);

        update_toolbar(enc);

        bytes = strToBytes(str);

        var type = '';

        if (bytes.length > 0) {
            if (from == 'base58') {
                try { 
                    var res = parseBase58Check(str); 
                    type = 'Check ver.' + res[0];
                    bytes = res[1];
                } catch (err) {
                    bytes = Bitcoin.Base58.decode(str);
                }
            } else if (from == 'hex') {
                bytes = Crypto.util.hexToBytes(str.replace(/[ :,]+/g,''));
            } else if (from == 'rfc1751') {
                try { bytes = english_to_key(str); } catch (err) { type = ' ' + err; bytes = []; };
            } else if (from == 'mnemonic') {
                bytes = Crypto.util.hexToBytes(mn_decode(str.trim()));
            } else if (from == 'base64') {
                try { bytes = Crypto.util.base64ToBytes(str); } catch (err) {}
            }

            if (to == 'base58') {
                text = Bitcoin.Base58.encode(bytes);
            } else if (to == 'hex') {
                text = Crypto.util.bytesToHex(bytes);
            } else if (to == 'text') {
                text = bytesToString(bytes);
            } else if (to == 'rfc1751') {
                text = key_to_english(bytes);
            } else if (to == 'mnemonic') {
                text = mn_encode(Crypto.util.bytesToHex(bytes));
            } else if (to == 'base64') {
                text = Crypto.util.bytesToBase64(bytes);
            } 
        }

        $('#hint_from').text(enct(from) + type + ' (' + bytes.length + ' byte' + (bytes.length == 1 ? ')' : 's)'));
        $('#hint_to').text(enct(to) + ' (' + text.length + ' character' + (text.length == 1 ? ')' : 's)'));
        $('#dest').val(text);
    }

    function onChangeFrom() {
        clearTimeout(timeout);
        timeout = setTimeout(translate, gen_timeout);
    }

    function onInput(id, func) {
        $(id).bind("input keyup keydown keypress change blur", function() {
            if ($(this).val() != jQuery.data(this, "lastvalue")) {
                func();
            }
            jQuery.data(this, "lastvalue", $(this).val());
        });
        $(id).bind("focus", function() {
           jQuery.data(this, "lastvalue", $(this).val());
        });
    }

    // --- chain ---
    var oldseed = [];
    var seed = [];
    var chainCode = [];
    var pubKey = [];
    var rounds = 0;
    var master_pubkey = [];
    var master_pt = null;
    var master_exp = null;
    var chain_mode = 'csv';
    var addresses = [];
    var addr_change = [];
    var chain_range = 6;
    var chain_type = 'chain_electrum';

    function onChangeMethod() {
        chain_mode = $(this).attr('id');
        update_chain();
    }

    function update_chain() {
        if (addresses.length == 0)
            return;
        var str = '';
        if (chain_mode == 'csv') {
            for (var i = 0; i < addresses.length; i++)
                str += (i+1) + ', "' + addresses[i][0] +'", "' + addresses[i][1] +'"\n';
        } else if (chain_mode == 'json') {
            var w = {};
            w['keys'] = [];
            for (var i = 0; i < addresses.length; i++)
                w['keys'].push({'addr':addresses[i][0],'sec':addresses[i][1]});
            str = JSON.stringify(w, null, 4);
        } else if (chain_mode == 'electrum') {

            var w = {};
            w['change_addresses'] = [];
            w['fee'] = 0.0001;
            w['master_public_key'] = Crypto.util.bytesToHex(master_pubkey);
            w['change_addresses'] = addresses[0][0];
            w['addresses'] = [];
            for (var i = 1; i < addresses.length; i++)
                w['addresses'].push(addresses[i][0]);
            w['seed'] = $('#seed').val();
            w['use_encryption'] = false;
            w['seed_version'] = 4;
            str = JSON.stringify(w, null, 4);
        }
        $('#chain').text(str);
    }

    function onChangeSeed() {
        clearTimeout(timeout);
        timeout = setTimeout(chain_generate, gen_timeout);
    }

    function onChangeMemo() {
        clearTimeout(timeout);
        timeout = setTimeout(chain_generate, gen_timeout);
    }

    function onChangeChain() {
        chain_type = $(this).attr('id');
        rounds = 0;

        if (chain_type == 'chain_electrum') {
            $('#seed').focus();
        } else {
            $('#memo').focus();
        }

        $('#seed').attr('readonly', chain_type != 'chain_electrum');
        $('#memo').attr('readonly', chain_type != 'chain_armory');

        chain_generate();
    }

    function onChangeFocus() {
        var id = $(this).attr('id');
        $('#seed').attr('readonly', id != 'seed');
        $('#memo').attr('readonly', id != 'memo');
        if (id == 'seed') {
            $('#chain_electrum').button('toggle');
            chain_type = 'chain_electrum';
        }
        else {
            $('#chain_armory').button('toggle');
            chain_type = 'chain_armory';
        }
    }

    function onSeedRandom() {
        clearTimeout(timeout);
        var bytes = Crypto.util.randomBytes(16);
        $('#seed').val(Crypto.util.bytesToHex(bytes));
        chain_generate();
    }

    function dhash(bytes) {
        return Crypto.SHA256(Crypto.SHA256(bytes, {asBytes: true}), {asBytes: true});
    }

    function get_sequence(n, for_change) {
        var mode = for_change ? 1 : 0;
        var s = dhash( strToBytes(n + ':' + mode + ':').concat(master_pubkey) );
        return BigInteger.fromByteArrayUnsigned(s);
    }

    function create_new_address(n, for_change) {
        var curve = getSECCurveByName("secp256k1");
        var z = get_sequence(n, for_change);
        var pubkey_point = master_pt.add(curve.getG().multiply(z));
        var compressed = false;
        var pub = getEncoded(pubkey_point, compressed);
        var hash = Bitcoin.Util.sha256ripe160(pub);
        var addr = new Bitcoin.Address(hash);
        var secexp = BigInteger.fromByteArrayUnsigned(master_exp).add(z).mod(curve.getN());
        var payload = secexp.toByteArrayUnsigned();
        var sec = new Bitcoin.Address(payload); sec.version = 128;
        return [addr.toString(), sec.toString()];
    }

    function onChangeRange() {
        chain_range = parseInt($('#range').val());
        clearTimeout(timeout);
        timeout = setTimeout(update_chain_range, gen_timeout);
    }

    function update_chain_range() {
        if (chain_type == 'chain_electrum') {
            electrum_gen();
        } else {
            armory_gen();
        }
    }

    function electrum_wallet(exponent) {
        master_exp = exponent;
        var curve = getSECCurveByName("secp256k1");
        var secexp = BigInteger.fromByteArrayUnsigned(exponent);
        var pt = curve.getG().multiply(secexp);
        var pubkey = getEncoded(pt, false);
        pubkey.shift();
        master_pubkey = pubkey;
        master_pt = pt;
        chain_range = parseInt($('#range').val());
        update_chain_range();
    }

    function electrum_batch() {
        for (var i = 0; i < 1000; i++)
            seed = Crypto.SHA256(seed.concat(oldseed), {asBytes: true});
        rounds -= 1000;
        if (rounds > 0) {
            var p = 100 - rounds * 100 / 100000;
            var pp = Math.floor(p) + '%';
            $('#chain').text('Key strengthening: ' + pp);
            timeout = setTimeout(electrum_batch, 0);
        } else {
            electrum_wallet(seed);
        }
    }

    function electrum_gen() {
        addresses = [];
        for (var i = 0; i < chain_range; i++) {
            //first address is for change
            var for_change = (i == 0);
            var n = (i == 0) ? i : i-1;
            addresses.push(create_new_address(n, for_change));
        }
        update_chain();
    }

    function armory_gen() {

        var codes = $('#memo').val();
        var keys = armory_decode_keys(codes);
        privKey = keys[0];
        chainCode = keys[1];
        var curve = getSECCurveByName("secp256k1");
        var secexp = BigInteger.fromByteArrayUnsigned(privKey);
        var pt = curve.getG().multiply(secexp);
        pubKey = pt.getEncoded();

        addresses = [];
        for (var i = 0; i < chain_range; i++) {
            r = armory_extend_keys(pubKey, chainCode, privKey, true);
            addresses.push( [r[0], r[1]] );
            pubKey = r[2];
            privKey = r[3];
        }
        update_chain();
    }

    function chain_generate(secexp) {

        var str = $('#seed').val();

        rounds = 0;
        addresses = [];
        $('#chain').text('');

        if (chain_type == 'chain_electrum') {
            if (secexp && secexp.length == 64) {
                return electrum_wallet( Crypto.util.hexToBytes(secexp) );
            }
            seed = strToBytes(str);
            oldseed = seed;
            rounds = 100000;
            timeout = setTimeout(electrum_batch, 0);
        } else if (chain_type == 'chain_armory') {

            timeout = setTimeout(armory_gen, 0);
        }
    }

    $(document).ready(
        function() {

            onInput('#pass', onChangePass);
            onInput('#hash', onChangeHash);
            onInput('#sec', onChangePrivKey);

            $('#from_pass').click(update_gen_from);
            $('#from_hash').click(update_gen_from);
            $('#from_sec').click(update_gen_from);

            $('#pass').focus(update_gen_from_focus);
            $('#hash').focus(update_gen_from_focus);
            $('#sec').focus(update_gen_from_focus);

            $('#random').click(gen_random);

            $('#uncompressed').click(update_gen_compressed);
            $('#compressed').click(update_gen_compressed);

            $('#pass').val('correct horse battery staple');
            calc_hash();
            generate();
            $('#pass').focus();

            onInput('#src', onChangeFrom);

            $("body").on("click", "#enc_from .btn", update_enc_from);
            $("body").on("click", "#enc_to .btn", update_enc_to);

            if (window.location.hash == '#converter')
                $('#tab-converter').tab('show');
            else if (window.location.hash == '#chains')
                $('#tab-chains').tab('show');

            $('#seed_random').click(onSeedRandom);

            $('#csv').click(onChangeMethod);
            $('#json').click(onChangeMethod);
            $('#electrum').click(onChangeMethod);

            $('#chain_armory').click(onChangeChain);
            $('#chain_electrum').click(onChangeChain);

            $('#seed').focus(onChangeFocus);
            $('#memo').focus(onChangeFocus);

            onInput($('#range'), onChangeRange);
            onInput($('#seed'), onChangeSeed);
            onInput($('#memo'), onChangeMemo);

            $('#memo').val(armory_test_codes);
        }
    );
})(jQuery);
