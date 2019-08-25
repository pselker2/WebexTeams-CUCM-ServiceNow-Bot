'use strict';
/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~/
/                                                                              /
/ This bot is built with Botkit. This bot as well as Botkit are covered by     /
/ the MIT Copyright.                                                           /
/                                                                              /
/~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

// Import Botkit's core features
const { Botkit } = require('botkit');

// Import a platform-specific adapter for webex.
const { WebexAdapter } = require('botbuilder-adapter-webex');

require('dotenv').config();

// From:  https://stackoverflow.com/questions/35633829/node-js-error-process-env-node-tls-reject-unauthorized-what-does-this-mean  and from "Devnet Dev Support Questions" Webex Teams space  
//The statement below is to ignore self-signed certs.  Similar to Postman in Settings (wrench top right) General: turn off SSL cert verification 
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const adapter = new WebexAdapter({    
    access_token: process.env.access_token,
    public_address: process.env.public_address
})    

const controller = new Botkit({
    adapter: adapter
});

// Initialize values
var descrptn = "Wash-DC_Unallocated";
var secProfileName = "Cisco 8865 - Standard SIP Non-Secure Profile"; 
var newdescrptn = "Wash-DC";
const https = require('https');
const request = require('request');
const ngrok_address = process.env.public_address;
const cucm_address = process.env.cucm_address; 
const devInstance = process.env.devInstance;
const table = process.env.table;    
 
// Basic authorization is a CUCM Application user and the password
const auth = 'Basic ' + new Buffer.from(process.env.axl_username + ":" + process.env.axl_password).toString("base64");

// Basic authorization for SNOW is admin and password
const snowauth = 'Basic ' + new Buffer.from(process.env.snow_username + ":" + process.env.snow_password).toString("base64");

// processInput is a function that wraps a Promise that
// parses the message from the Teams space.  
// The message came from "message.text"
    
const processInput = (input) => {
    return new Promise((resolve, reject) => {
        
        const splitText = input.split(" ");
        const userid = splitText[2];
        const phntype = splitText[4];
        const phnlocation = splitText[6];
        const dn = splitText[8];
        const inc_number = splitText[10];
        const sysid = splitText[12];

        // Set descrptn to the correct location for unallocated phones
        // Set newdescrptn to the location and the urserid

        if (phnlocation == "wash_dc"){
            descrptn = "Wash-DC_Unallocated";
            newdescrptn = "Wash-DC " + userid;
        }else if (phnlocation == "san_jose_ca"){
            descrptn = "San-Jose-CA_Unallocated";
            newdescrptn = "San-Jose-CA " + userid;
        }else {
                descrptn = "Dallas-TX_Unallocated";
                newdescrptn = "Dallas-TX " + userid;
              };

        // Set Security Profile Name based on phntype selection from ServiceNow
        // std_user is Cisco 7841
        // knowledge_worker is Cisco 8865
        // exec_desktop is Cisco DX80


        if (phntype == "std_user"){
            secProfileName = "Cisco 7841 - Standard SIP Non-Secure Profile";
        }else if (phntype == "knowledge_worker"){
            secProfileName = "Cisco 8865 - Standard SIP Non-Secure Profile";      
        }else {secProfileName = "Cisco Telepresence DX80 - Standard SIP Non-Secure Profile";
              };

        var endpts = [ userid, phntype, phnlocation, dn, descrptn, newdescrptn, secProfileName, inc_number, sysid];
        resolve(endpts);
    }).catch((Error) => {
        console.log("processInput Error: in promise chain:  " + Error);
        });
};


// addDN is a function that wraps a Promise that
// Adds the DN to CUCM
// DN must be added before updating the phone
    
const addDN = (endpts) => { 
    return new Promise((resolve, reject) => {
    
        const dn = endpts[3];    
        const options = { 
            "method": "POST",
            "hostname": cucm_address,
            "port": 8443,
            "path": "/axl/",
            "headers": {
                "Authorization": auth,
                "SOAPAction": "CUCM:DB ver=11.5 addLine",
                "Content-Type": "text/plain"
            }
        };

        console.log("addDN options: ");  // Debug
        console.log(JSON.stringify(options)); // Debug
        
        const req = https.request(options, (res) => {
            console.log('status code: ' + res.statusCode);  // Debug
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error('statusCode=' + res.statusCode));
            } 
            
            var body = [];
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                body.push(chunk);
                console.log("Got Data: " + body);  //Debug
            });
            res.on('end', function() {
                try {
                    body = JSON.stringify(body);
                    console.log("body in try: " + body);  //Debug
                } catch(e) {
                    reject(e);
                }
                console.log("addDN: Before resolve endpts");  //Debug
                resolve(endpts);
            });
        });
        
        req.on('error', (e) => {
          reject(e.message);
        });
         
        req.write("<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://www.cisco.com/AXL/API/11.5\">\n    <soapenv:Header/>\n    <soapenv:Body>\n        <ns:addLine>\n        \t<line>\n            \t<pattern>" + dn + "</pattern>\n            \t<routePartitionName>P_Internal</routePartitionName>\n            </line>\n        </ns:addLine>\n    </soapenv:Body>\n</soapenv:Envelope>");
        req.end(function() {
        	console.log("addDN req.end ");  //Debug
        });
    }).catch((Error) => {
        console.log("addDN Error: in promise chain:  " + Error);
        });
};


// findUnallocPhone is a function that wraps a Promise that
// Finds an unallocated endpoint in CUCM with the desired phnlocation/descrptn and 
// phntype/secProfileName
// Using secProfileName because it is part of the listPHone namespace and model is not.

const findUnallocPhone = (endpts) => {
    return new Promise((resolve, reject) => {    

        const descrptn = endpts[4];
        const secProfileName = endpts[6];
        const options = { 
             "method": "POST",
             "hostname": cucm_address,
             "port": 8443,
              "path": "/axl/",
              "headers": {
                  "Authorization": auth,
                  "SOAPAction": "CUCM:DB ver=11.5 listPhone",
                  "Content-Type": "text/plain"
            }
        };

        console.log("findUnallocPhone options: ");  // Debug
        console.log(JSON.stringify(options));  // Debug

        const req = https.request(options, (res) => {
        console.log('status code: ' + res.statusCode);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error('statusCode=' + res.statusCode));
        } 
        var body = [];
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            body.push(chunk);
            console.log("Got Data: " + body);  // Debug
        });
        res.on('end', function() {
            try {
                body = JSON.stringify(body);
                console.log("body in try: " + body);  // Debug

                //Process the body to get the <name>

                const splitbody = (body.toString()).split("<");
                const endptname = splitbody[6].split(">");
                const endpointnm = endptname[1];
                console.log("splitbody:" + splitbody);  // Debug
                console.log("splitbody[6]: " + splitbody[6] + "endptname: " + endpointnm + "endpointnm: " + endpointnm); // Debug

                endpts[9] = endpointnm;
                console.log("findUnallocPhone: endpts[9]: " + endpts[9] + " endpointnm: " + endpointnm);  // Debug
                } catch(e) {
                    reject(e);
                }
                console.log("findUnallocPhone: Before resolve endpts");  // Debug
                resolve(endpts);
            });    
        });
        req.on('error', (e) => {
            reject(e.message);
        });

        req.write("<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://www.cisco.com/AXL/API/11.5\">\\n    <soapenv:Header/>\n    <soapenv:Body>\n        <ns:listPhone>\n        \t<searchCriteria>\n            \t<description>" + descrptn + "</description> \n            \t<securityProfileName>" + secProfileName + "</securityProfileName>\n            </searchCriteria>\n            <returnedTags>\n            \t<name/>\n            </returnedTags>\n        </ns:listPhone>\n    </soapenv:Body>\n</soapenv:Envelope>");
        req.end(function() {
            console.log("P3 req.end ");  // Debug
        });
    }).catch((Error) => {
        console.log("FindUnallocPhone Error: in promise chain:  " + Error);
        });
};


// updatePhone is a function that wraps a Promise that
// Update endpoint with user information and dn

const updatePhone = (endpts) => {
    return new Promise((resolve, reject) => {
 
        const endpm = endpts[9];
        const newdescrptn = endpts[5];
        const dn = endpts[3];
        const userid = endpts[0];
        console.log("updatePhone:  endpm: " + endpm + " newdescrptn: " + newdescrptn + " DN: " + dn + " userid: " +userid); //Debug
        const options = { 
            "method": "POST",
            "hostname": cucm_address,
            "port": 8443,
            "path": "/axl/",
            "headers": {
                "Authorization": auth,
                "SOAPAction": "CUCM:DB ver=11.5 updatePhone",
                "Content-Type": "text/plain"
            }
        };

        console.log("updatePhone options: ");  //Debug
        console.log(JSON.stringify(options));  //Debug

        const req = https.request(options, (res) => {
            console.log('status code: ' + res.statusCode);
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error('statusCode=' + res.statusCode));
            } 
            var body = [];
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                body.push(chunk);
                console.log("Got Data: " + body);  //Debug
            });
            res.on('end', function() {
                try {
                    body = JSON.stringify(body);
                    console.log("updatePhone: body in try: " + body);  //Debug
                } catch(e) {
                    reject(e);
                }
                console.log("updatePhone: Before resolve endpts");  //Debug
                resolve(endpts);
            });
        });
        req.on('error', (e) => {
          reject(e.message);
        });

        req.write("<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://www.cisco.com/AXL/API/11.5\">\\n    <soapenv:Header/>\n    <soapenv:Body>\n        <ns:updatePhone>\n            \t<name>" + endpm + "</name>\n            \t<description>" + newdescrptn + "</description>\n                <callingSearchSpaceName>CSS_HQ</callingSearchSpaceName>\n                <devicePoolName>VTSC</devicePoolName>\n                <lines>\n                \t<line>\n                \t\t<index>1</index>\n                \t\t<dirn>\n                \t\t\t<pattern>" + dn + "</pattern>\n                \t\t\t<routePartitionName>P_Internal</routePartitionName>\n                \t\t</dirn>\n                \t</line>\n                </lines>\n                <ownerUserName>" + userid + "</ownerUserName>\n        </ns:updatePhone>\n    </soapenv:Body>\n</soapenv:Envelope>");
        req.end(function() {
            console.log("updatePhone req.end ");  //Debug
        });
        
    }).catch((Error) => {
        console.log("updatePhone Error: in promise chain:  " + Error);
        });
};


// updateSNOWticket is a function that wraps a Promise that
// updates and closes the SNOW ticket that started the Bot update-phone action

const updateSNOWticket = (endpts) => {
    return new Promise((resolve, reject) => {
 
        const sysid = endpts[8];
        const options = { 
            "method": "PATCH",
            "hostname": devInstance + ".service-now.com",
            "path": "/api/now/table/" + table + "/" + sysid,
            "headers": {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": snowauth,
                "Cache-Control": "no-cache",
                "Host": devInstance + ".service-now.com"
           }
        };

        console.log("updateSNOWticket options: ");  //Debug
        console.log(JSON.stringify(options));  //Debug
        
        const req = https.request(options, (res) => {
            console.log('status code: ' + res.statusCode);
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error('statusCode=' + res.statusCode));
            } 
            var body = [];
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                body.push(chunk);
                //Debug console.log("Got Data: " + body);
            });
            res.on('end', function() {
                try {
                    body = JSON.stringify(body);
                   //Debug console.log("body in try: " + body);
                } catch(e) {
                    reject(e);
                }
                console.log("updateSNOWticket: Before resolve endpts");  //Debug
                resolve(endpts);
            });
        });
        req.on('error', (e) => {
          reject(e.message);
        });

        req.write("{\"short_description\":\"This endpoint was added via the ServiceNowCUCM Bot.\",\"state\":\"3\"}");
        req.end(function() {
            console.log("updateSNOWticket: req.end ");  //Debug
        });
    }).catch((Error) => {
        console.log("updateSNOWticket Error: in promise chain:  " + Error);
        });
};
        

// Bot "update-phone" command

controller.hears('update-phone', 'message,direct_message,direct_mention', async(bot,message) => { 
    
    // message.text is a Botkit value-store that contains the infomation from the SNOW user "ticket" 
    // that is in the update-phone message to Teams.
    // processInput is a function that wraps the first promise in the chain.
    //
    // Step 1 in chain is function "processInput" processing the information from message.text into local values and 
    // translateing the type of user into a specific endpoint model.
    // processInput returns the processed information. 
    //
    // Step 2 is function addDN that adds the DN/directory number of the new endpoint to CUCM.
    //
    // Step 3 is function findUnallocPhone that finds an Unallocated/new_endpoint in CUCM with the desired characteristics.
    //
    // Step 4 is function updatePhone that uses all the information to provision the new_endpoint. 
    //
    // Step 5 is function updateSNOWticket that updates and closes the SNOW ticket.

    try{
	const processedInput1 = await processInput(message.text);
	console.log("Between P1 -> P2");  // Debug
	const processedInput2 = await addDN(processedInput1);  			  
	console.log("Between P2 -> P3"); // Debug
	const processedInput3 = await findUnallocPhone(processedInput2);  
	console.log("Between P3 -> P4"); // Debug
	const processedInput4 = await updatePhone(processedInput3);       
	console.log("Between P4 -> P5"); // Debug
	await updateSNOWticket(processedInput4);                          
	} 
	
    catch(e) { 
        console.log("Error: in promise chain "); 
        reject (e);
    };
    
    await bot.reply(message, '**The ServiceNow ticket was updated**' + '\n');
});
  
// Bot "help" command 

controller.hears('help','message,direct_message',async(bot, message) => {
    console.log('Text from the Message:' + message.text);// Debug
    await bot.reply(message, '*This Bot will process user information from ServiceNow and provision a new phone for the user.*' + '\n' + '\n');
});    

// Bot handling input that is not a command

controller.on('message,direct_message', async(bot, message) => {
    console.log('Message:' + message.text);
    await bot.reply(message, 'I do not understand. Please retype your message.');
    
});

