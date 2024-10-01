const http = require('http');
const https = require('https');
const crypto = require('crypto');

const landscapeApi = async (api, accessKey, secretKey, action, params) => {
  params['action'] = action;
  params['access_key_id'] = accessKey;
  params['signature_method'] = 'HmacSHA256';
  params['signature_version'] = '2';
  params['timestamp'] = new Date().toISOString().split('.')[0] + 'Z';
  params['version'] = '2011-08-01';

  const keys = Array.from(Object.keys(params));
  keys.sort();

  const newParams = {};
  for (const key of keys) {
    if (typeof(params[key]) === 'string')
      newParams[key] = params[key];
    else {
      params[key].forEach((val, idx) => {
        newParams[`${key}.${idx + 1}`] = val;
      });
    }
  }

  const queryString = Object.entries(newParams).map(([key, val]) => `${encodeRFC3986URIComponent(key)}=${encodeRFC3986URIComponent(val)}`).join('&');

  const parts = api.match(/https?:\/\/([a-zA-Z0-9.\-]*)(.*)/);
  const hostname = parts[1].toLowerCase();
  const uri = parts[2];

  const stringToSign = `POST\n${hostname}\n${uri}\n${queryString}`;

  const signature = sign(stringToSign, secretKey);

  newParams['signature'] = signature;

  const urlSearchParams = new URLSearchParams(newParams);
  const requestUri = `${api}?${urlSearchParams.toString()}`;

  const process = (resolve, reject) => res => {
    let body = '';

    res.on('data', chunk => body += chunk);

    res.on('end', () => {
      try {
        const obj = JSON.parse(body);
        resolve(obj);
      } catch (e) {
        reject(body);
      }
    });
  };

  const reqOpts = {
    host: hostname,
    path: uri,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': urlSearchParams.toString().length
    }
  };

  const lib = api.startsWith('https') ? https : http;
  
  return new Promise((res, rej) => {
    const req = lib.request(reqOpts, process(res, rej));

    req.on('error', rej);

    req.write(urlSearchParams.toString());

    req.end();
  });
};

const sign = (str, key) => {
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(str);
  return hmac.digest().toString('base64');
};

const encodeRFC3986URIComponent = str => {
  return encodeURIComponent(str).replace(/[!'()*]g/, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
};

const oneHourFromNow = () => {
  const dt = new Date();
  dt.setHours(dt.getHours() + 1);
  return dt;
}

const main = async () => {
  const [_1, _2, op] = process.argv;

  const apiCall = async (action, params) => await landscapeApi(process.env.LANDSCAPE_API_URI, process.env.LANDSCAPE_API_KEY, process.env.LANDSCAPE_API_SECRET, action, params);

  const rebootWithDelay = async ids => await apiCall('RebootComputers', { deliver_after: oneHourFromNow().toISOString().split('.')[0] + 'Z', computer_ids: ids });

  switch (op) {
    case 'reboot-all': {
      const allComputers = await apiCall('GetComputers', {});
      console.log(JSON.stringify(await rebootWithDelay(allComputers.map(it => it.id + '')), null, 2));
      break;
    }
    case 'reboot-needed': {
      const rebootNeededComputers = await apiCall('GetComputers', {query: 'needs:reboot'});
      if (rebootNeededComputers.length === 0) {
        console.log('No computers needed reboot');
        return;
      }

      console.log(`Rebooting ${rebootNeededComputers.map(it => `${it.title} (${it.hostname})`).join(', ')}`);
      await rebootWithDelay(rebootNeededComputers.map(it => it.id + ''));
      break;
    }
    default: {
      console.error(`Invalid op: ${op}`);
    }
  }
};

main();